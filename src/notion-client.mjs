/**
 * 通过 Notion MCP 将总结文档追加到页面
 * 使用 @notionhq/notion-mcp-server（npx 启动），需配置 NOTION_TOKEN
 */
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
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

/**
 * 把总结结果通过 MCP 追加到 Notion 页面
 * @param {{ summaryTitle: string, summarySections: Array<{ title: string, bullets: string[] }> }} summary
 */
export async function appendSummaryToNotion(summary) {
  if (!NOTION_PAGE_ID || !NOTION_TOKEN) {
    throw new Error('Missing NOTION_PAGE_ID and NOTION_TOKEN (或 NOTION_API_KEY)');
  }

  const blocks = [];

  // 标题
  blocks.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: summary.summaryTitle || '邮件摘要' } }],
    },
  });

  // 每段：小标题 + 要点
  for (const section of summary.summarySections || []) {
    blocks.push({
      object: 'block',
      type: 'heading_3',
      heading_3: {
        rich_text: [{ type: 'text', text: { content: section.title || '（无标题）' } }],
      },
    });
    for (const bullet of section.bullets || []) {
      for (const chunk of chunkText(bullet)) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: chunk } }],
          },
        });
      }
    }
  }

  if (blocks.length <= 1) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: '暂无有效邮件摘要。' } }],
      },
    });
  }

  const blockId = NOTION_PAGE_ID.replace(/-/g, '');

  const mcpClient = new MultiServerMCPClient({
    mcpServers: {
      notion: {
        command: 'npx',
        args: ['-y', '@notionhq/notion-mcp-server'],
        env: {
          NOTION_TOKEN,
        },
      },
    },
  });

  try {
    const tools = await mcpClient.getTools();
    // 官方 Notion MCP 工具名：append-block-children（本地 npm 包）
    const appendTool = tools.find(
      (t) =>
        t.name === 'append-block-children' ||
        t.name === 'append_block_children' ||
        (typeof t.name === 'string' && t.name.toLowerCase().includes('append') && t.name.toLowerCase().includes('block'))
    );
    if (!appendTool) {
      console.warn('可用 MCP 工具:', tools.map((t) => t.name).join(', '));
      throw new Error('Notion MCP 未提供 append-block-children 工具，请确认已安装 @notionhq/notion-mcp-server');
    }
    const result = await appendTool.invoke({
      block_id: blockId,
      children: blocks,
    });
    if (result && typeof result === 'object' && result.content) {
      return result.content;
    }
    return result;
  } finally {
    await mcpClient.close();
  }
}
