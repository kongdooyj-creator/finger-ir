import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSameTitle, normalizeTitle, normalizeUrl, titleSimilarity } from '../src/dedupe.ts';

test('URL 정규화: utm·모바일·http 차이를 같은 것으로', () => {
  const a = normalizeUrl('http://m.newspim.com/news/view/20261019000240?utm_source=naver&utm_medium=rss');
  const b = normalizeUrl('https://www.newspim.com/news/view/20261019000240/');
  assert.equal(a, b);
  assert.equal(a, 'newspim.com/news/view/20261019000240');
});

test('URL 정규화: 의미 있는 쿼리는 유지하고 정렬', () => {
  assert.equal(normalizeUrl('https://www.edaily.co.kr/News/Read?newsId=0348&b=1#top'), 'edaily.co.kr/News/Read?b=1&newsId=0348');
});

test('제목 정규화: 매체 접미사·태그·기호 제거', () => {
  assert.equal(normalizeTitle("[단독] 핑거 '파로스 ERP' 첫 적용 - 뉴스핌"), '핑거파로스erp첫적용');
});

test('유사 제목 묶기', () => {
  const a = normalizeTitle("핑거 '파로스 ERP', 제93회 국가공인 AT 자격시험 첫 적용");
  const b = normalizeTitle("핑거 '파로스 ERP', 제93회 국가공인 AT 자격시험 첫 적용…교육·실무 활용 확대");
  assert.equal(isSameTitle(a, b), true); // 긴 제목이 짧은 제목을 포함
  const c = normalizeTitle('핑거, 회계 자격시험 진입…기업용 ERP 확장 포석');
  assert.equal(isSameTitle(a, c), false);
  assert.ok(titleSimilarity(a, a) === 1);
});
