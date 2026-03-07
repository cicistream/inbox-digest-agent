/**
 * 用 Qwen（DashScope 兼容接口）从邮件列表中筛选「有效邮件」并总结成文档结构
 * 与项目根目录 .env 一致：OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_NAME
 */
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

const SYSTEM = `你是一个邮件助手。用户会给你一批邮件（每封包含：发件人、主题、日期、正文摘要）。
请完成两件事：
1. 筛选「有效邮件」：排除明显垃圾、营销、自动通知、退订类；保留需要用户关注或回复的（工作、重要通知、待办相关等）。
2. 对有效邮件写一份简洁的总结文档，便于直接放到 Notion：
   - 文档标题：例如「邮件摘要 YYYY-MM-DD」
   - 按邮件逐条：用简短标题（主题或概括）+ 2～4 句要点（谁发的、关键信息、是否需要行动）。
输出严格为 JSON：{ "validCount": number, "summaryTitle": "标题", "summarySections": [ { "title": "某封邮件标题", "bullets": ["要点1","要点2"] } ] }`;

/**
 * @param {Array<{ from, subject, date, bodyPlain, snippet }>} emails
 * @returns {Promise<{ validCount: number, summaryTitle: string, summarySections: Array<{ title: string, bullets: string[] }> }>}
 */
export async function filterAndSummarize(emails) {
  if (!emails?.length) {
    return { validCount: 0, summaryTitle: '邮件摘要（无新邮件）', summarySections: [] };
  }

  const input = emails
    .slice(0, 50)
    .map(
      (e, i) =>
        `[${i + 1}] 发件人: ${e.from}\n主题: ${e.subject}\n日期: ${e.date}\n正文摘要: ${(e.bodyPlain || e.snippet || '').slice(0, 800)}`
    )
    .join('\n\n');

  const completion = await openai.chat.completions.create({
    model: process.env.MODEL_NAME || 'qwen-turbo',
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `请处理以下邮件并输出 JSON：\n\n${input}` },
    ],
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) {
    return { validCount: 0, summaryTitle: '邮件摘要', summarySections: [] };
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { validCount: 0, summaryTitle: '邮件摘要', summarySections: [] };
  }
}
