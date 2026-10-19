// 배포된 Worker 의 Workers AI 분류를 점검한다.
// 사용: node scripts/ai-test.mjs <사이트 URL> <ADMIN_TOKEN> ["기사 제목"]
const [,, target, token, title] = process.argv;
const t0 = Date.now();
const res = await fetch(`${target.replace(/\/$/, '')}/api/ai-test`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ title: title || '핑거, 메가존클라우드 지분 1.21% 약 300억에 양수 결정' }),
  signal: AbortSignal.timeout(280000),
});
console.log(res.status, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(JSON.stringify(await res.json(), null, 2));
