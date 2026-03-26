import './load-env.mjs';
import { processReminderQueue } from './notifier.mjs';
import { listThreadQueue, updateThreadState } from './state-db.mjs';

function usage() {
  console.log(`Usage:
  node src/actions-cli.mjs list [limit]
  node src/actions-cli.mjs ack <thread_key>
  node src/actions-cli.mjs done <thread_key>
  node src/actions-cli.mjs snooze <thread_key>
  node src/actions-cli.mjs retry:run
`);
}

function printTable(rows) {
  if (!rows.length) {
    console.log('No thread items found.');
    return;
  }
  for (const r of rows) {
    console.log([
      `[${r.bucket || 'watch'}]`,
      `[${r.state}]`,
      r.last_subject || '(no subject)',
      `from=${r.last_from || 'unknown'}`,
      `thread=${r.thread_key}`,
    ].join(' '));
  }
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) {
    usage();
    process.exit(1);
  }
  if (cmd === 'list') {
    const limit = parseInt(process.argv[3] || '50', 10);
    const rows = listThreadQueue(Number.isFinite(limit) ? limit : 50);
    printTable(rows);
    return;
  }
  if (cmd === 'retry:run') {
    await processReminderQueue();
    console.log('retry queue processed');
    return;
  }

  const threadKey = process.argv[3];
  if (!threadKey) {
    console.error('thread_key is required');
    usage();
    process.exit(1);
  }

  if (cmd === 'ack') {
    updateThreadState(threadKey, 'ack');
    console.log(`ack updated: ${threadKey}`);
    return;
  }
  if (cmd === 'done') {
    updateThreadState(threadKey, 'done');
    console.log(`done updated: ${threadKey}`);
    return;
  }
  if (cmd === 'snooze') {
    updateThreadState(threadKey, 'snoozed');
    console.log(`snoozed updated: ${threadKey}`);
    return;
  }

  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

