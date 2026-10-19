import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRelevant } from '../src/filter.ts';

test('공식 표기는 항상 통과', () => {
  assert.equal(isRelevant('(주)핑거, 3분기 실적 발표', '').pass, true);
  assert.equal(isRelevant('㈜핑거 신제품', '').pass, true);
  assert.equal(isRelevant('핑거(163730) 특징주', '').pass, true);
});

test('핑거 + 관련 키워드면 통과', () => {
  assert.equal(isRelevant("핑거 '파로스 ERP', 국가공인 AT 자격시험 첫 적용", '').pass, true);
  assert.equal(isRelevant('핑거, 메가존클라우드 지분 300억 양수 결정', '').pass, true);
  assert.equal(isRelevant('핀테크 기업 핑거 전환사채 발행', '').pass, true);
});

test('오탐은 제외', () => {
  assert.equal(isRelevant('홈파티 핑거푸드 레시피 10선', '').pass, false);
  assert.equal(isRelevant('스마트폰 핑거프린트 센서 신기술', '지문 인식 투자 확대').pass, false);
  assert.equal(isRelevant('골드핑거 리뷰', '').pass, false);
  assert.equal(isRelevant('손가락 핑거 운동', '').pass, false);
});

test('핑거가 없거나 키워드가 없으면 제외', () => {
  assert.equal(isRelevant('코스닥 상승 마감', '').pass, false);
  assert.equal(isRelevant('핑거 밴드 신곡 발표', '').pass, false);
});

test('짧은 영문 약어는 단어 경계로 검사', () => {
  assert.equal(isRelevant('핑거 CB 950억', '').pass, true);
  assert.equal(isRelevant('핑거 WEBTOON 소식', '').pass, false); // "BW"가 WEBTOON 안에 없음, IR 도 없음
});
