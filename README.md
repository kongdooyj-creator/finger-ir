# 핑거 IR 자동 뉴스 클리핑

(주)핑거(코스닥 163730) 관련 기사를 **2시간마다 자동 수집·분류**하고 모바일 대시보드로 보여주는 Cloudflare Workers 사이트입니다. PC가 꺼져 있어도 Cloudflare 크론이 돌립니다.

- 수집: RSS(뉴스핌·전자신문·디일렉·비즈워치·Google/Bing 뉴스 검색) + 네이버 뉴스 검색 API(키 있을 때)
- 분류: Cloudflare **Workers AI**(무료 할당)로 논조·심각도·요약 판정, 실패 시 키워드 규칙
- 저장: **Neon Postgres**(Vercel 프로젝트 finger-ir 에 연결). `DATABASE_URL` 시크릿이 없으면 Cloudflare **D1**을 씁니다
- 화면: 대시보드 / 이슈로그 / 기사아카이브, 등급 기준 `/criteria`
  - Cloudflare 주소와 Vercel 주소 둘 다 같은 화면입니다. Vercel 쪽은 `vercel.json` 이 `/api/*` 를 Cloudflare Worker 로 넘깁니다

## 0. D1 → Neon 이전 (한 번만)

1. Vercel 프로젝트 finger-ir → Storage → Neon 생성 → 프로젝트에 연결
2. Neon 연결 문자열(`DATABASE_URL`)을 Worker 시크릿으로 등록: `npx wrangler secret put DATABASE_URL`
3. `npx wrangler deploy`
4. 데이터 복사(여러 번 실행해도 안전):

```bash
curl -X POST https://finger-ir.<계정>.workers.dev/api/admin/migrate-to-pg -H "Authorization: Bearer <ADMIN_TOKEN>"
curl https://finger-ir.<계정>.workers.dev/api/admin/db-status -H "Authorization: Bearer <ADMIN_TOKEN>"
```

`db-status` 의 `using` 이 `neon-postgres` 이고 `current`(Neon) 행 수가 `d1` 과 같으면 끝입니다. D1 은 지우지 않고 백업으로 남겨 둡니다.

## 1. 최초 설정 (한 번만)

```bash
npm install
npx wrangler login          # 브라우저가 열리면 Allow
npx wrangler d1 create finger-ir
```

`d1 create` 출력의 `database_id` 값을 `wrangler.toml`의 `REPLACE_WITH_D1_ID` 자리에 넣습니다. 그 다음:

```bash
npx wrangler d1 migrations apply finger-ir --remote
```

### 시크릿

```bash
npx wrangler secret put ADMIN_TOKEN           # 관리자 토큰(아무 긴 문자열). 화면 ⚙ 에 입력해 이슈 편집·즉시 수집에 사용
npx wrangler secret put NAVER_CLIENT_ID       # 선택. https://developers.naver.com → 애플리케이션 등록 → 검색 API
npx wrangler secret put NAVER_CLIENT_SECRET   # 선택
```

네이버 키가 없으면 네이버 소스만 건너뛰고 RSS로 동작합니다.

### 배포

```bash
npx wrangler deploy
```

출력에 나온 `https://finger-ir.<계정>.workers.dev` 가 사이트 주소입니다. 크론(`0 */2 * * *`)은 배포와 함께 등록됩니다.

## 2. 기존 데이터 가져오기 (선택)

기존 사이트의 `/api/dashboard` JSON을 한 번 넣으면 이슈 18건, 기사(URL 중복 제외 36건), 언론 계약 현황이 들어옵니다.

```bash
node scripts/import-legacy.mjs https://finger-ir.<계정>.workers.dev <ADMIN_TOKEN>
```

같은 데이터를 다시 넣어도 중복 저장되지 않습니다. 이미 임포트한 뒤 계약 현황만 다시 넣고 싶을 때도 같은 명령을 다시 실행하면 됩니다.

## 3. 바로 수집해 보기

```bash
curl -X POST https://finger-ir.<계정>.workers.dev/api/fetch-now -H "Authorization: Bearer <ADMIN_TOKEN>"
```

또는 화면 오른쪽 위 ⚙ → 토큰 저장 → "지금 수집 실행". 수집은 백그라운드로 돌고 응답은 바로 옵니다(1~2분 뒤 새로고침). 끝날 때까지 기다리려면 주소 끝에 `?wait=1`을 붙입니다.

### AI 분류 점검

```bash
curl -X POST https://finger-ir.<계정>.workers.dev/api/ai-test -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d "{\"title\":\"핑거, 메가존클라우드 지분 300억 양수 결정\"}"
```

모델별 응답 시간과 원문, 최종 분류 결과를 돌려줍니다. 모델 호출은 한 번에 25초를 넘기면 다음 모델로 넘어가고, 모두 실패하면 키워드 규칙으로 분류합니다. 실패 사유는 `/api/runs`의 `errors`에 `AI:`로 남습니다.

## 4. 로컬 개발

```bash
npm run migrate:local
npm run dev                                   # http://localhost:8787
curl "http://localhost:8787/__scheduled"      # 크론 핸들러 강제 실행
npm test                                      # 필터·중복·파서 단위 테스트
```

로컬에서 시크릿은 `.dev.vars` 파일에 `ADMIN_TOKEN=...` 형식으로 둡니다(커밋 금지).

## 5. 운영 확인

- `GET /api/runs` — 최근 수집 이력(소스별 수집 수, 신규, 필터 제외, 오류)
- `npx wrangler tail` — 실시간 로그. 크론이 돌면 `cron ok {...}` 가 찍힙니다
- Workers AI 모델은 `wrangler.toml`의 `AI_MODEL` / `AI_MODEL_FALLBACK` 로 교체. 사용 가능한 모델은 `npx wrangler ai models`

## 6. 키워드 조정

오탐 필터·피드·네이버 검색어는 D1 `settings` 테이블의 JSON 값으로 덮어쓸 수 있습니다. 예:

```bash
npx wrangler d1 execute finger-ir --remote --command "INSERT OR REPLACE INTO settings(key,value) VALUES ('exclude_keywords','[\"핑거푸드\",\"핑거프린트\"]')"
```

키: `include_keywords`, `exclude_keywords`, `feeds`, `naver_queries`. 기본값은 `src/filter.ts`, `src/sources/rss.ts`, `src/sources/naver.ts` 에 있습니다.

## 구조

```
src/index.ts        fetch(라우팅) + scheduled(크론)
src/pipeline.ts     수집 → 필터 → 중복 제거 → 분류 → 이슈 연결 → 실행 기록
src/sources/        rss.ts(RSS/Atom 파서), naver.ts(네이버 API)
src/filter.ts       "핑거" 오탐 제거 규칙
src/dedupe.ts       URL 정규화, 제목 유사도
src/classify.ts     Workers AI 분류 + 규칙 폴백 (기준 IR-2026-10-14-v1)
src/issues.ts       이슈 매칭·생성·상향 규칙
src/legacy.ts       기존 엑셀 JSON 임포터
src/api.ts          /api/* 핸들러
public/index.html   모바일 우선 화면
public/criteria.html 등급 판단 기준
```
