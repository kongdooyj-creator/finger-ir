import { test } from 'node:test';
import assert from 'node:assert/strict';
import { excelDate, rowsOf } from '../src/legacy.ts';
import { parseFeed } from '../src/sources/rss.ts';
import { classifyByRule } from '../src/classify.ts';

test('엑셀 시리얼 → 날짜', () => {
  assert.equal(excelDate('46134')?.slice(0, 10), '2026-04-22');
  assert.equal(excelDate('2026.10.13')?.slice(0, 10), '2026-10-13');
  assert.equal(excelDate('10-13', 2026)?.slice(0, 10), '2026-10-13');
  assert.equal(excelDate(''), null);
});

test('셀 맵 → 행 맵', () => {
  const rows = rowsOf({ A3: { value: 'ID' }, B3: { value: '날짜' }, A4: { value: 'ISS-1' }, B4: { value: '' }, C4: { value: 46134 } });
  assert.deepEqual(rows.get(3), { A: 'ID', B: '날짜' });
  assert.deepEqual(rows.get(4), { A: 'ISS-1', C: '46134' });
});

test('RSS 파싱 (CDATA, 구글 뉴스 매체 접미사)', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[핑거 '파로스 ERP' 첫 적용 - 뉴스핌]]></title><link>https://news.google.com/rss/articles/abc</link>
      <pubDate>Mon, 19 Oct 2026 02:00:00 GMT</pubDate><description>&lt;p&gt;요약 &amp; 내용&lt;/p&gt;</description><source url="https://newspim.com">뉴스핌</source></item>
    <item><title>링크 없는 항목</title></item>
  </channel></rss>`;
  const items = parseFeed(xml, 'Google 뉴스 검색');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "핑거 '파로스 ERP' 첫 적용");
  assert.equal(items[0].publisher, '뉴스핌');
  assert.equal(items[0].summary, '요약 & 내용');
  assert.equal(items[0].publishedAt, '2026-10-19T02:00:00.000Z');
});

test('규칙 분류는 심각도를 확정하지 않는다', () => {
  const c = classifyByRule("상폐 결정' 제일엠앤에스, 핑거 계열에 매각", '');
  assert.equal(c.tone, '공격');
  assert.equal(c.severity, '확인 필요');
  assert.match(c.evidence, /상 \(상폐\)/);
});
