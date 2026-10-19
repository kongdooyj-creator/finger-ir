import type { Env, Severity, Tone } from './types.ts';
import { SEVERITIES, TONES } from './types.ts';
import { insertArticle, insertIssue, nowIso } from './db.ts';
import { normalizeTitle, normalizeUrl } from './dedupe.ts';

/** 기존 사이트 /api/dashboard JSON 의 시트 구조 */
interface Cell { value: unknown; style?: number }
interface Sheet { name?: string; cells: Record<string, Cell>; rowCount?: number }
export interface LegacyDump {
  sheets?: { issues?: Sheet; archive?: Sheet; dashboard?: Sheet };
  layout?: { cells?: Record<string, Cell> };
}

type Row = Record<string, string>; // 열 문자 → 값

export function rowsOf(cells: Record<string, Cell>): Map<number, Row> {
  const rows = new Map<number, Row>();
  for (const [addr, c] of Object.entries(cells)) {
    const m = addr.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const v = c?.value;
    if (v === '' || v === null || v === undefined) continue;
    const r = Number(m[2]);
    if (!rows.has(r)) rows.set(r, {});
    rows.get(r)![m[1]] = String(v).trim();
  }
  return rows;
}

/** 엑셀 시리얼(46134) 또는 "10-13" / "2026.10.13" 문자열 → ISO 날짜 */
export function excelDate(v: string | undefined, year = 2026): string | null {
  if (!v) return null;
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const ms = Math.round((parseFloat(v) - 25569) * 86400e3);
    return new Date(ms).toISOString();
  }
  let m = v.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString();
  m = v.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
  if (m) return new Date(Date.UTC(year, +m[1] - 1, +m[2])).toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function cleanTone(v: string | undefined): Tone {
  const t = (v || '').replace(/\s*\(AI\)\s*$/, '').trim();
  return TONES.includes(t as Tone) ? (t as Tone) : '미분류';
}
function cleanSeverity(v: string | undefined): Severity {
  const s = (v || '').replace(/\s*\(AI\)\s*$/, '').trim();
  if (s === '미확인' || s === '') return '확인 필요';
  return SEVERITIES.includes(s as Severity) ? (s as Severity) : '확인 필요';
}
function severityCodeFromNote(note: string | undefined): string | null {
  return note?.match(/심각도\s*[상중하]\s*\((H[123]|M[123]|L1)\)/)?.[1] ?? null;
}
function mapStatus(v: string | undefined): string {
  const s = v || '';
  if (s.startsWith('완료')) return s.includes('보고') ? '진행' : '완료';
  if (s.includes('대응중') || s.includes('진행')) return '진행';
  return '신규';
}

export interface ImportResult { issues: number; articles: number; contracts: number; skipped: number; errors: string[] }

/** 멱등 임포트: legacy_id 가 이미 있으면 건너뛴다 */
export async function importLegacy(env: Env, dump: LegacyDump): Promise<ImportResult> {
  const res: ImportResult = { issues: 0, articles: 0, contracts: 0, skipped: 0, errors: [] };
  const legacyIssueIds = new Map<string, number>();

  const { results: existingIssues } = await env.DB.prepare('SELECT id, legacy_id FROM issues WHERE legacy_id IS NOT NULL').all<{ id: number; legacy_id: string }>();
  for (const r of existingIssues) legacyIssueIds.set(r.legacy_id, r.id);
  const { results: existingArts } = await env.DB.prepare('SELECT legacy_id, url_norm FROM articles').all<{ legacy_id: string | null; url_norm: string }>();
  const haveArt = new Set(existingArts.map((a) => a.legacy_id).filter(Boolean) as string[]);
  const haveUrl = new Set(existingArts.map((a) => a.url_norm));

  // 이슈로그: ID·등록일·이슈제목·관련매체·심각도·이슈 내용·담당자·상태·대응 내용·마감기한·최종업데이트일·비고
  const issueSheet = dump.sheets?.issues;
  if (issueSheet) {
    for (const [r, row] of [...rowsOf(issueSheet.cells).entries()].sort((a, b) => a[0] - b[0])) {
      const id = row.A;
      if (r < 4 || !/^ISS-\d+$/.test(id || '')) continue;
      if (legacyIssueIds.has(id)) { res.skipped++; continue; }
      try {
        const created = excelDate(row.B) ?? nowIso();
        const updated = excelDate(row.K) ?? created;
        const newId = await insertIssue(env, {
          title: row.C || id,
          summary: row.F || '',
          severity: cleanSeverity(row.E),
          severity_code: severityCodeFromNote(row.L),
          severity_ai: cleanSeverity(row.E),
          status: mapStatus(row.H),
          suggested_action: row.I || '',
          memo: row.L || '',
          media: row.D || '',
          legacy_id: id,
          created_at: created,
          updated_at: updated,
        });
        legacyIssueIds.set(id, newId);
        res.issues++;
      } catch (e) { res.errors.push(`${id}: ${String(e)}`); }
    }
  }

  // 기사아카이브: ID·날짜·매체·기사 제목/요약·구분·작성기자·담당자·논조·게시여부·URL·관련이슈ID·비고
  const artSheet = dump.sheets?.archive;
  if (artSheet) {
    for (const [r, row] of [...rowsOf(artSheet.cells).entries()].sort((a, b) => a[0] - b[0])) {
      const id = row.A;
      if (r < 4 || !/^ART-\d+$/.test(id || '')) continue;
      if (haveArt.has(id)) { res.skipped++; continue; }
      const url = row.J && /^https?:\/\//.test(row.J) ? row.J : `legacy://${id}`;
      const url_norm = normalizeUrl(url);
      if (haveUrl.has(url_norm)) { res.skipped++; continue; }
      try {
        const title = row.D || id;
        const issueLegacy = row.K?.match(/ISS-\d+/)?.[0];
        const issueId = issueLegacy ? legacyIssueIds.get(issueLegacy) ?? null : null;
        const note = row.L || '';
        const aiLine = note.split('\n').find((l) => l.includes('[AI기준]')) || '';
        await insertArticle(env, {
          url, url_norm, title, title_norm: normalizeTitle(title),
          summary: note.replace(/\[AI기준\][^\n]*/g, '').trim().slice(0, 600),
          publisher: row.C || '', published_at: excelDate(row.B), source: '기존 아카이브',
          tone: cleanTone(row.H), tone_by: 'legacy',
          severity: '확인 필요', severity_code: null,
          confidence: 0, ai_summary: title, evidence: aiLine, issue_id: issueId, legacy_id: id,
        });
        haveUrl.add(url_norm);
        res.articles++;
      } catch (e) { res.errors.push(`${id}: ${String(e)}`); }
    }
  }

  // 언론·계약 현황: 대시보드 레이아웃 50행 헤더, 51행~ 데이터
  const layoutCells = dump.layout?.cells;
  if (layoutCells) {
    const rows = rowsOf(layoutCells);
    // "관계/계약상태" 열이 있는 행을 헤더로 본다 (기존 보고서는 50행)
    // 구역 제목("3. 언론 매체 관계·계약 현황")이나 요약 행이 아니라 열 머리글이 3개 이상인 행만 헤더로 인정
    const headerRowNo = [...rows.keys()].sort((a, b) => a - b).find((r) => {
      const vals = Object.values(rows.get(r)!);
      return r >= 40 && vals.length >= 3 && vals.some((h) => /계약상태|업체명|매체명/.test(h));
    });
    const header = headerRowNo ? rows.get(headerRowNo) : undefined;
    if (header && headerRowNo) {
      const col = (pred: (h: string) => boolean) => Object.entries(header).find(([, h]) => pred(h))?.[0];
      const cRel = col((h) => /관계|계약상태/.test(h));
      const cContact = col((h) => /담당|기자|연락/.test(h));
      const cNote = col((h) => /비고|메모|특이/.test(h));
      const cPeriod = col((h) => /기간/.test(h));
      const cCost = col((h) => /비용|금액/.test(h));
      // 매체 열 이름이 다를 수 있어 넓게 찾고, 없으면 헤더의 첫 텍스트 열(번호 열 제외)을 쓴다
      const cPub = col((h) => /매체|언론|회사|업체|기관|채널|이름/.test(h))
        ?? Object.entries(header).find(([c, h]) => c !== cRel && c !== cContact && c !== cNote && !/^(no|번호|순번|연번|#)$/i.test(h))?.[0];
      const { results: existing } = await env.DB.prepare('SELECT publisher FROM media_contracts').all<{ publisher: string }>();
      const have = new Set(existing.map((e) => e.publisher));
      if (cPub) {
        for (const [r, row] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
          if (r <= headerRowNo || r > headerRowNo + 20) continue;
          if (Object.keys(row).length === 1 && row.A) break; // 다음 구역 제목이 나오면 끝
          const pub = row[cPub];
          if (!pub || /^\d+$/.test(pub) || have.has(pub)) continue;
          const get = (c?: string) => (c ? row[c] || '' : '');
          const cost = get(cCost);
          const costText = /^\d+$/.test(cost) ? `연 ${Number(cost).toLocaleString('ko-KR')}원` : cost;
          const note = [get(cPeriod) && `기간 ${get(cPeriod)}`, costText, get(cNote)].filter(Boolean).join(' · ');
          await env.DB.prepare('INSERT INTO media_contracts (publisher, relation, status, contact, note) VALUES (?,?,?,?,?)')
            .bind(pub, get(cRel), get(cRel), get(cContact), note).run();
          have.add(pub);
          res.contracts++;
        }
      }
    }
  }
  return res;
}
