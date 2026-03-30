/**
 * 将总结文档追加到 Notion 页面
 * 优先用 Notion MCP；若 MCP 连接超时或失败则回退到直接 Notion API
 */
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const NOTION_PAGE_ID = process.env.NOTION_PAGE_ID;
const NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
const BUCKET_ORDER = ['do_now', 'this_week', 'watch'];
const BUCKET_CONFIG = {
  do_now: { title: 'Do Now', color: 'red' },
  this_week: { title: 'This Week', color: 'yellow' },
  watch: { title: 'Watch', color: 'blue' },
};
const SELECT_COLORS = {
  high: 'red',
  medium: 'yellow',
  low: 'gray',
  new: 'blue',
  ack: 'yellow',
  done: 'green',
  snoozed: 'gray',
};
const ALL_BUCKET_PROPERTIES = ['邮件', '发件人', '截止', '优先级', '状态', '下一步', '批次'];
const LEGACY_REMOVABLE_PROPERTIES = ['原邮件', '线程', '摘要批次', '邮件时间', '置信度'];

/**
 * Notion 单条 rich_text 有长度限制，按 2000 字符分段
 */
function chunkText(text, maxLen = 2000) {
  const out = [];
  let s = String(text ?? '');
  while (s.length) {
    out.push(s.slice(0, maxLen));
    s = s.slice(maxLen);
  }
  return out.length ? out : [''];
}

function sanitizeText(text) {
  return String(text ?? '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function truncateText(text, maxLen = 120) {
  const sanitized = sanitizeText(text);
  if (sanitized.length <= maxLen) return sanitized;
  return `${sanitized.slice(0, Math.max(0, maxLen - 1))}\u2026`;
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function asRichTextCell(text, { url, color } = {}) {
  const content = truncateText(text || '—');
  const cell = {
    type: 'text',
    text: {
      content,
      ...(url && /^https?:\/\//i.test(url) ? { link: { url } } : {}),
    },
  };
  if (color) {
    cell.annotations = { color };
  }
  return [cell];
}

function bucketLabel(bucket) {
  if (bucket === 'do_now') return 'Do Now';
  if (bucket === 'this_week') return 'This Week';
  if (bucket === 'watch') return 'Watch';
  return sanitizeText(bucket || '—');
}

function actionLine(card) {
  if (card.summary) return sanitizeText(card.summary);
  if (card.action_required) return '请打开原邮件确认并处理下一步。';
  return '继续观察，无需立即处理。';
}

function notionPageId() {
  return NOTION_PAGE_ID.replace(/-/g, '');
}

function selectOption(name) {
  return {
    name,
    color: SELECT_COLORS[String(name || '').toLowerCase()] || 'default',
  };
}

function optionLabel(value, fallback = 'UNKNOWN') {
  const raw = sanitizeText(value || fallback);
  return raw ? raw.toUpperCase() : fallback;
}

export function buildBucketDatabasePayload(bucket) {
  const config = BUCKET_CONFIG[bucket] || { title: sanitizeText(bucket || 'Inbox'), color: 'default' };
  const properties =
    bucket === 'watch'
      ? {
          邮件: { title: {} },
          状态: { select: { options: ['NEW', 'ACK', 'DONE', 'SNOOZED'].map(selectOption) } },
          批次: { rich_text: {} },
        }
      : bucket === 'this_week'
        ? {
            邮件: { title: {} },
            截止: { date: {} },
            优先级: { select: { options: ['HIGH', 'MEDIUM', 'LOW'].map(selectOption) } },
            状态: { select: { options: ['NEW', 'ACK', 'DONE', 'SNOOZED'].map(selectOption) } },
            下一步: { rich_text: {} },
            批次: { rich_text: {} },
          }
        : {
            邮件: { title: {} },
            发件人: { rich_text: {} },
            截止: { date: {} },
            优先级: { select: { options: ['HIGH', 'MEDIUM', 'LOW'].map(selectOption) } },
            状态: { select: { options: ['NEW', 'ACK', 'DONE', 'SNOOZED'].map(selectOption) } },
            下一步: { rich_text: {} },
            批次: { rich_text: {} },
          };
  return {
    title: [
      {
        type: 'text',
        text: { content: config.title },
        annotations: { color: config.color },
      },
    ],
    properties,
  };
}

export function buildBucketPageProperties(card, summaryTitle) {
  const base = {
    邮件: {
      title: [
        {
          type: 'text',
          text: {
            content: truncateText(card.title || '（无主题）', 180),
            ...(sanitizeText(card.url || '') ? { link: { url: sanitizeText(card.url) } } : {}),
          },
        },
      ],
    },
    状态: { select: { name: optionLabel(card.state || (card.action_required ? 'NEW' : 'SNOOZED')) } },
    批次: {
      rich_text: [{ type: 'text', text: { content: truncateText(summaryTitle, 120) } }],
    },
  };

  if (card.bucket === 'watch') {
    return base;
  }

  base.截止 = card.due_by ? { date: { start: card.due_by } } : { date: null };
  base.优先级 = { select: { name: optionLabel(card.priority, 'LOW') } };
  base.下一步 = {
    rich_text: [{ type: 'text', text: { content: truncateText(actionLine(card), 500) } }],
  };

  if (card.bucket === 'do_now') {
    base.发件人 = {
      rich_text: [{ type: 'text', text: { content: truncateText(card.from || '—', 200) } }],
    };
  }

  return base;
}

function sortCardsForBucket(cards, bucket) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const byDueAsc = (a, b) => String(a.due_by || '9999-12-31').localeCompare(String(b.due_by || '9999-12-31'));
  const byPriorityThenDue = (a, b) =>
    (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99) || byDueAsc(a, b);
  const byNewestFirst = (a, b) => String(b.date || '').localeCompare(String(a.date || ''));

  if (bucket === 'do_now') return [...cards].sort(byDueAsc);
  if (bucket === 'this_week') return [...cards].sort(byPriorityThenDue);
  return [...cards].sort(byNewestFirst);
}

export function buildNotionBlocks(summary) {
  const dateTitle = sanitizeText(summary.summaryTitle || '邮件摘要');
  const cards = Array.isArray(summary.actionCards) ? summary.actionCards : [];
  const validCount =
    typeof summary.validCount === 'number'
      ? summary.validCount
      : cards.length || (Array.isArray(summary.summarySections) ? summary.summarySections.length : 0);

  if (!cards.length) {
    return [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: [
            {
              type: 'text',
              text: { content: `${dateTitle}（有效 ${validCount}）` },
            },
          ],
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content: '暂无有效邮件摘要。' } }],
              },
            },
          ],
        },
      },
    ];
  }

  const sortedCards = [...cards].sort((a, b) => {
    const bucketOrder = { do_now: 0, this_week: 1, watch: 2 };
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return (
      (bucketOrder[a.bucket] ?? 99) - (bucketOrder[b.bucket] ?? 99) ||
      (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99) ||
      String(a.date || '').localeCompare(String(b.date || ''))
    );
  });

  const headerRow = {
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        asRichTextCell('分组'),
        asRichTextCell('邮件'),
        asRichTextCell('发件人'),
        asRichTextCell('截止'),
        asRichTextCell('优先级'),
        asRichTextCell('置信度'),
        asRichTextCell('下一步'),
      ],
    },
  };

  const rows = sortedCards.map((card) => ({
    object: 'block',
    type: 'table_row',
    table_row: {
      cells: [
        asRichTextCell(bucketLabel(card.bucket)),
        asRichTextCell(card.title || '（无主题）', { url: card.url }),
        asRichTextCell(card.from || '—'),
        asRichTextCell(card.due_by || '未标明'),
        asRichTextCell(sanitizeText(card.priority || '—').toUpperCase()),
        asRichTextCell(sanitizeText(card.confidence || '—').toUpperCase()),
        asRichTextCell(actionLine(card)),
      ],
    },
  }));

  const tableChildren = [headerRow, ...rows];
  const tableChunks = chunkArray(tableChildren, 99);
  return tableChunks.map((chunk, idx) => {
    const tableTitleSuffix = tableChunks.length > 1 ? `（表 ${idx + 1}/${tableChunks.length}）` : '';
    const children = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: `动作总览：${validCount} 条，按优先级和时间分桶排序。${tableTitleSuffix}` },
              annotations: { color: 'gray' },
            },
          ],
        },
      },
      {
        object: 'block',
        type: 'table',
        table: {
          table_width: 7,
          has_column_header: true,
          has_row_header: false,
          children: chunk,
        },
      },
    ];

    return {
      object: 'block',
      type: 'toggle',
      toggle: {
        rich_text: [
          {
            type: 'text',
            text: { content: `${dateTitle}（有效 ${validCount}）${tableTitleSuffix}` },
          },
        ],
        children,
      },
    };
  });
}

async function listAllBlockChildren(notion, blockId) {
  const items = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    items.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return items;
}

async function ensureBucketDatabase(notion, pageId, bucket) {
  const config = BUCKET_CONFIG[bucket];
  const children = await listAllBlockChildren(notion, pageId);
  const existing = children.find(
    (block) => block.type === 'child_database' && sanitizeText(block.child_database?.title) === config.title
  );
  if (existing) {
    const payload = buildBucketDatabasePayload(bucket);
    const propertiesPatch = Object.fromEntries(
      [...ALL_BUCKET_PROPERTIES, ...LEGACY_REMOVABLE_PROPERTIES].map((name) => [name, payload.properties[name] || null])
    );
    await notion.databases.update({
      database_id: existing.id,
      title: payload.title,
      is_inline: true,
      properties: propertiesPatch,
    });
    return existing.id;
  }

  const payload = buildBucketDatabasePayload(bucket);
  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: pageId },
    is_inline: true,
    title: payload.title,
    properties: payload.properties,
  });
  return created.id;
}

async function archiveDigestRows(notion, databaseId, summaryTitle) {
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      filter: {
        property: '批次',
        rich_text: { equals: summaryTitle },
      },
    });
    for (const row of response.results) {
      await notion.pages.update({ page_id: row.id, archived: true });
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
}

async function syncSummaryToDatabases(summary) {
  const cards = Array.isArray(summary.actionCards) ? summary.actionCards : [];
  if (!cards.length) return false;

  const notion = new NotionClient({ auth: NOTION_TOKEN });
  const pageId = notionPageId();

  for (const bucket of BUCKET_ORDER) {
    const databaseId = await ensureBucketDatabase(notion, pageId, bucket);
    await archiveDigestRows(notion, databaseId, summary.summaryTitle);

    const bucketCards = sortCardsForBucket(
      cards.filter((card) => card.bucket === bucket),
      bucket
    );
    for (const card of bucketCards) {
      await notion.pages.create({
        parent: { database_id: databaseId },
        properties: buildBucketPageProperties(card, summary.summaryTitle),
      });
    }
  }

  return true;
}

/**
 * 把总结结果通过 MCP 追加到 Notion 页面
 * @param {{ validCount?: number, summaryTitle: string, summarySections: Array<{ title: string, bullets: string[], url?: string, from?: string, date?: string }> }} summary
 */
export async function appendSummaryToNotion(summary) {
  if (!NOTION_PAGE_ID || !NOTION_TOKEN) {
    throw new Error('Missing NOTION_PAGE_ID and NOTION_TOKEN (或 NOTION_API_KEY)');
  }

  try {
    const synced = await syncSummaryToDatabases(summary);
    if (synced) return;
  } catch (dbErr) {
    console.warn(`Notion database 写入失败，回退到静态表格块：${dbErr?.message || dbErr}`);
  }

  const blocks = buildNotionBlocks(summary);
  const blockId = notionPageId();

  const appendViaApi = async () => {
    const notion = new NotionClient({ auth: NOTION_TOKEN });
    await notion.blocks.children.append({ block_id: blockId, children: blocks });
  };

  try {
    const mcpClient = new MultiServerMCPClient({
      mcpServers: {
        notion: {
          command: 'npx',
          args: ['-y', '@notionhq/notion-mcp-server'],
          env: { NOTION_TOKEN },
        },
      },
    });
    try {
      const tools = await mcpClient.getTools();
      const appendTool = tools.find(
        (t) =>
          t.name === 'append-block-children' ||
          t.name === 'append_block_children' ||
          (typeof t.name === 'string' && t.name.toLowerCase().includes('append') && t.name.toLowerCase().includes('block'))
      );
      if (appendTool) {
        await appendTool.invoke({ block_id: blockId, children: blocks });
        return;
      }
      console.warn('Notion MCP 未找到 append 工具，改用直接 API 写入…');
      await appendViaApi();
      return;
    } finally {
      await mcpClient.close();
    }
  } catch (mcpErr) {
    const msg = mcpErr?.message || String(mcpErr);
    if (/timed out|timeout|EPIPE|Failed to connect|MCP error|No append tool/i.test(msg)) {
      console.warn('Notion MCP 不可用，改用直接 API 写入…');
      await appendViaApi();
      return;
    }
    throw mcpErr;
  }
}
