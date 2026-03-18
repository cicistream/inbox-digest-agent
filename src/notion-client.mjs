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

/**
 * 把总结结果通过 MCP 追加到 Notion 页面
 * @param {{ validCount?: number, summaryTitle: string, summarySections: Array<{ title: string, bullets: string[], url?: string, from?: string, date?: string }> }} summary
 */
export async function appendSummaryToNotion(summary) {
  if (!NOTION_PAGE_ID || !NOTION_TOKEN) {
    throw new Error('Missing NOTION_PAGE_ID and NOTION_TOKEN (或 NOTION_API_KEY)');
  }

  const dateTitle = sanitizeText(summary.summaryTitle || '邮件摘要');
  const validCount =
    typeof summary.validCount === 'number'
      ? summary.validCount
      : Array.isArray(summary.summarySections)
        ? summary.summarySections.length
        : 0;

  // Toggle 内的内容块
  const children = [];
  for (const section of summary.summarySections || []) {
    const title = sanitizeText(section.title || '（无标题）');
    const url = section.url;
    const from = sanitizeText(section.from || '');
    const date = sanitizeText(section.date || '');
    const meta = [from && `From: ${from}`, date && `At: ${date}`].filter(Boolean).join('  ·  ');
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: url
          ? [
              {
                type: 'text',
                text: { content: title, link: { url } },
                annotations: { color: 'blue', underline: true },
              },
              ...(meta
                ? [
                    {
                      type: 'text',
                      text: { content: `  —  ${meta}` },
                      annotations: { color: 'gray' },
                    },
                  ]
                : []),
            ]
          : [
              { type: 'text', text: { content: title } },
              ...(meta
                ? [
                    {
                      type: 'text',
                      text: { content: `  —  ${meta}` },
                      annotations: { color: 'gray' },
                    },
                  ]
                : []),
            ],
      },
    });

    for (const bullet of section.bullets || []) {
      const sanitizedBullet = sanitizeText(bullet);
      const richText = chunkText(sanitizedBullet).map((chunk) => ({
        type: 'text',
        text: { content: chunk },
      }));
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText },
      });
    }
  }

  if (children.length === 0) {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: '暂无有效邮件摘要。' } }],
      },
    });
  }

  const blocks = [
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
        children,
      },
    },
  ];

  const blockId = NOTION_PAGE_ID.replace(/-/g, '');

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
