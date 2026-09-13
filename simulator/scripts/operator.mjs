import { readFile } from 'node:fs/promises';

const [action, id] = process.argv.slice(2);
if (!['pause', 'resume', 'skip', 'remove'].includes(action) || (action === 'remove' && !id)) {
  throw new Error('Usage: node scripts/operator.mjs pause|resume|skip|remove [submission-id]');
}
let token = process.env.ADMIN_TOKEN;
if (!token) {
  const local = await readFile(new URL('../.dev.vars', import.meta.url), 'utf8').catch(() => '');
  token = local.match(/^ADMIN_TOKEN="([^"]+)"/m)?.[1];
}
if (!token) throw new Error('Set ADMIN_TOKEN in your environment or ignored .dev.vars file.');
const response = await fetch('https://www.hackthisbuilding.com/api/admin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action, ...(id ? { id } : {}) }),
});
const state = await response.json();
if (!response.ok) throw new Error(state.error || `Operator request failed (${response.status})`);
console.log(JSON.stringify({ paused: state.paused, phase: state.phase, waiting: state.queue.length }, null, 2));
