import { describe, expect, it } from 'vitest';
import { buildSuppressionKeyFromActionCard, buildSuppressionKeyFromNotionPage } from '../src/suppression-key.mjs';

describe('suppression-key', () => {
  it('prefers url for action-card suppression key', () => {
    expect(buildSuppressionKeyFromActionCard({ url: 'https://example.com/mail/1', title: 'x' })).toBe(
      'url:https://example.com/mail/1'
    );
  });

  it('falls back to title and sender when url is missing', () => {
    expect(buildSuppressionKeyFromActionCard({ title: 'Interview', from: 'hr@example.com' })).toBe(
      'title:interview|from:hr@example.com'
    );
  });

  it('builds notion-page suppression key from title href', () => {
    const page = {
      properties: {
        邮件: {
          title: [{ plain_text: 'Interview', href: 'https://example.com/mail/1' }],
        },
      },
    };
    expect(buildSuppressionKeyFromNotionPage(page)).toBe('url:https://example.com/mail/1');
  });

  it('prefers explicit suppression key stored in Notion row metadata', () => {
    const page = {
      properties: {
        抑制键: {
          rich_text: [{ plain_text: 'thread:fallback:hr@example.com|interview' }],
        },
        邮件: {
          title: [{ plain_text: 'Interview' }],
        },
      },
    };
    expect(buildSuppressionKeyFromNotionPage(page)).toBe('thread:fallback:hr@example.com|interview');
  });
});
