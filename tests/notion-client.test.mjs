import { describe, expect, it } from 'vitest';
import {
  buildAutoArchiveFilter,
  buildBucketDatabasePayload,
  buildBucketPageProperties,
  buildNotionBlocks,
} from '../src/notion-client.mjs';

describe('notion-client', () => {
  it('builds a tabular Notion layout from action cards', () => {
    const blocks = buildNotionBlocks({
      summaryTitle: '邮件摘要 2026-03-26',
      validCount: 2,
      actionCards: [
        {
          bucket: 'do_now',
          title: 'Interview scheduling',
          from: 'recruiter@company.com',
          due_by: '2026-03-27',
          priority: 'high',
          confidence: 'high',
          summary: '今天确认面试时间',
          url: 'https://example.com/mail/1',
          date: '2026-03-26T10:00:00Z',
        },
        {
          bucket: 'watch',
          title: 'Application received',
          from: 'jobs@company.com',
          due_by: '',
          priority: 'low',
          confidence: 'medium',
          summary: '',
          action_required: false,
          url: '',
          date: '2026-03-26T09:00:00Z',
        },
      ],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('toggle');
    expect(blocks[0].toggle.children[1].type).toBe('table');
    expect(blocks[0].toggle.children[1].table.table_width).toBe(7);

    const rows = blocks[0].toggle.children[1].table.children;
    expect(rows).toHaveLength(3);
    expect(rows[0].table_row.cells.map((cell) => cell[0].text.content)).toEqual([
      '分组',
      '邮件',
      '发件人',
      '截止',
      '优先级',
      '置信度',
      '摘要',
    ]);

    expect(rows[1].table_row.cells[0][0].text.content).toBe('Do Now');
    expect(rows[1].table_row.cells[1][0].text.content).toBe('Interview scheduling');
    expect(rows[1].table_row.cells[1][0].text.link.url).toBe('https://example.com/mail/1');
    expect(rows[1].table_row.cells[6][0].text.content).toBe('今天确认面试时间');

    expect(rows[2].table_row.cells[0][0].text.content).toBe('Watch');
    expect(rows[2].table_row.cells[3][0].text.content).toBe('未标明');
  });

  it('builds interactive database schema for bucket views', () => {
    const doNow = buildBucketDatabasePayload('do_now');
    const thisWeek = buildBucketDatabasePayload('this_week');
    const watch = buildBucketDatabasePayload('watch');

    expect(doNow.title[0].text.content).toBe('Do Now');
    expect(Object.keys(doNow.properties)).toEqual([
      '邮件',
      '发件人',
      '截止',
      '优先级',
      '状态',
      '摘要',
      '批次',
      '抑制键',
    ]);
    expect(Object.keys(thisWeek.properties)).toEqual(['邮件', '截止', '优先级', '状态', '摘要', '批次', '抑制键']);
    expect(Object.keys(watch.properties)).toEqual(['邮件', '状态', '批次', '抑制键']);
    expect(doNow.properties.优先级.select.options.map((x) => x.name)).toEqual(['HIGH', 'MEDIUM', 'LOW']);
  });

  it('builds database page properties with selectable enums', () => {
    const properties = buildBucketPageProperties(
      {
        title: 'Interview scheduling',
        from: 'recruiter@company.com',
        due_by: '2026-03-27',
        priority: 'high',
        confidence: 'medium',
        state: 'ack',
        summary: '今天确认面试时间',
        url: 'https://example.com/mail/1',
        thread_key: 'id:1',
        date: '2026-03-26T10:00:00Z',
      },
      '邮件摘要 2026-03-26'
    );

    expect(properties.邮件.title[0].text.link.url).toBe('https://example.com/mail/1');
    expect(properties.优先级.select.name).toBe('HIGH');
    expect(properties.状态.select.name).toBe('ACK');
    expect(properties.摘要.rich_text[0].text.content).toBe('今天确认面试时间');
    expect(properties.批次.rich_text[0].text.content).toBe('邮件摘要 2026-03-26');
    expect(properties.抑制键.rich_text[0].text.content).toBe('url:https://example.com/mail/1');
  });

  it('builds minimal watch panel properties', () => {
    const properties = buildBucketPageProperties(
      {
        bucket: 'watch',
        title: 'Application received',
        state: 'snoozed',
        url: 'https://example.com/mail/3',
      },
      '邮件摘要 2026-03-26'
    );

    expect(Object.keys(properties)).toEqual(['邮件', '状态', '批次', '抑制键']);
    expect(properties.状态.select.name).toBe('SNOOZED');
  });

  it('builds auto archive filters for interactive cleanup rules', () => {
    expect(buildAutoArchiveFilter('do_now')).toBeNull();
    expect(buildAutoArchiveFilter('this_week')).toEqual({
      property: '优先级',
      select: { equals: 'LOW' },
    });
    expect(buildAutoArchiveFilter('watch')).toEqual({
      property: '状态',
      select: { equals: 'DONE' },
    });
  });
});
