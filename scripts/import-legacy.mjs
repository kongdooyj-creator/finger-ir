// 기존 사이트의 /api/dashboard JSON 을 새 사이트로 1회 임포트한다.
// 사용: node scripts/import-legacy.mjs https://finger-ir.<계정>.workers.dev <ADMIN_TOKEN> [legacy.json]
const [,, target, token, file] = process.argv;
if (!target || !token) {
  console.error('사용: node scripts/import-legacy.mjs <새 사이트 URL> <ADMIN_TOKEN> [legacy.json]');
  process.exit(1);
}
const LEGACY = 'https://finger-ir-dashboard.1120joon.workers.dev/api/dashboard';
let dump;
if (file) {
  dump = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
} else {
  const res = await fetch(LEGACY);
  if (!res.ok) throw new Error(`기존 사이트 응답 ${res.status}`);
  dump = await res.json();
}
console.log(`기존 데이터: 이슈 ${dump.sheets?.issues?.recordCount ?? '?'}건, 기사 ${dump.sheets?.archive?.recordCount ?? '?'}건`);
const res = await fetch(`${target.replace(/\/$/, '')}/api/import-legacy`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ sheets: dump.sheets, layout: { cells: dump.layout?.cells } }),
});
console.log(res.status, JSON.stringify(await res.json(), null, 2));
