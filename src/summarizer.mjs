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
1. 筛选「有效邮件」：只排除「明显」垃圾、纯营销、退订/取关类、系统自动通知。其余一律视为有效（包括工作邮件、个人邮件、订阅、通知等），不要过度过滤。
2. 对有效邮件写一份简洁的总结文档，便于直接放到 Notion：
   - 文档标题：例如「邮件摘要 YYYY-MM-DD」
   - 按邮件逐条：用简短标题（主题或概括）+ 2～4 句要点（谁发的、关键信息、是否需要行动）。
输出严格为 JSON，不要包含其他文字或 markdown 代码块。格式：{ "validCount": number, "summaryTitle": "标题", "summarySections": [ { "title": "某封邮件标题", "bullets": ["要点1","要点2"] } ] }。
要求：validCount 必须等于 summarySections 的长度；只要有一封以上有效邮件，summarySections 必须至少有一条，不能为空数组。`;

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

  // 若模型返回被 ``` 包裹的 JSON，先剥掉
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const out = JSON.parse(jsonStr);
    const sections = Array.isArray(out.summarySections) ? out.summarySections : [];
    const validCount = typeof out.validCount === 'number' ? out.validCount : sections.length;
    const result = {
      validCount: sections.length > 0 ? sections.length : validCount,
      summaryTitle: out.summaryTitle || '邮件摘要',
      summarySections: sections,
    };
    // 模型返回了 0 条但输入有邮件：用原始邮件做兜底摘要，避免 Notion 为空
    if (result.summarySections.length === 0 && emails.length > 0) {
      const today = new Date().toISOString().slice(0, 10);
      result.summaryTitle = `邮件摘要 ${today}`;
      result.summarySections = emails.slice(0, 20).map((e) => ({
        title: e.subject || '（无主题）',
        bullets: [
          `发件人：${e.from || '未知'}`,
          (e.bodyPlain || e.snippet || '').slice(0, 300) || '无正文摘要',
        ],
      }));
      result.validCount = result.summarySections.length;
    }
    return result;
  } catch (e) {
    console.warn('总结 JSON 解析失败，使用兜底摘要。原始返回前 200 字:', raw.slice(0, 200));
    const today = new Date().toISOString().slice(0, 10);
    return {
      validCount: emails.length,
      summaryTitle: `邮件摘要 ${today}`,
      summarySections: emails.slice(0, 20).map((e) => ({
        title: e.subject || '（无主题）',
        bullets: [`发件人：${e.from || '未知'}`, (e.bodyPlain || e.snippet || '').slice(0, 300) || '无正文'],
      })),
    };
  }
}
