/**
 * Neon Postgres 를 HTTP(SQL over HTTPS)로 호출하는 작은 어댑터.
 * 코드가 이미 쓰는 D1 인터페이스(prepare().bind().first/all/run)만 흉내 내서 호출부를 거의 바꾸지 않는다.
 * 외부 패키지 없이 fetch 만 쓴다.
 */

type Row = Record<string, unknown>;

interface NeonField { name: string; dataTypeID: number }
interface NeonResult { rows: Row[]; fields: NeonField[]; rowCount: number | null; command: string }

// Postgres 타입 OID → JS 값
const INT_TYPES = new Set([20, 21, 23, 26]);          // int8, int2, int4, oid
const FLOAT_TYPES = new Set([700, 701, 1700]);        // float4, float8, numeric
const BOOL_TYPE = 16;
const JSON_TYPES = new Set([114, 3802]);

function parseValue(v: unknown, typeId: number): unknown {
  if (v === null || v === undefined) return null;
  if (INT_TYPES.has(typeId) || FLOAT_TYPES.has(typeId)) { const n = Number(v); return Number.isNaN(n) ? v : n; }
  if (typeId === BOOL_TYPE) return v === true || v === 't' || v === 'true';
  if (JSON_TYPES.has(typeId) && typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } }
  return v;
}

/** SQLite 식 ? 자리표시자를 $1, $2 … 로 바꾼다 (작은따옴표 문자열 안의 ? 는 건드리지 않음) */
export function toPgPlaceholders(sql: string): string {
  let out = '', n = 0, inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inStr = !inStr;
    if (ch === '?' && !inStr) { out += '$' + (++n); continue; }
    out += ch;
  }
  return out;
}

function toParam(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function neonEndpoint(connectionString: string): string {
  const host = new URL(connectionString.replace(/^postgres(ql)?:/, 'https:')).hostname;
  return `https://${host}/sql`;
}

export async function neonQuery(connectionString: string, query: string, params: unknown[] = []): Promise<NeonResult> {
  const res = await fetch(neonEndpoint(connectionString), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Neon-Connection-String': connectionString,
      'Neon-Raw-Text-Output': 'true',
      'Neon-Array-Mode': 'false',
    },
    body: JSON.stringify({ query, params: params.map(toParam) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text); msg = j.message || text; } catch { /* keep */ }
    throw new Error(`Neon ${res.status}: ${msg.slice(0, 300)} | SQL: ${query.slice(0, 120)}`);
  }
  const data = JSON.parse(text) as NeonResult;
  const types = new Map((data.fields || []).map((f) => [f.name, f.dataTypeID]));
  data.rows = (data.rows || []).map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r)) o[k] = parseValue(v, types.get(k) ?? 25);
    return o;
  });
  return data;
}

// id 열이 있는 테이블에 INSERT 하면 RETURNING id 를 붙여 last_row_id 를 흉내 낸다
const HAS_ID = /^\s*INSERT\s+INTO\s+(articles|issues|fetch_runs|media_contracts)\b/i;

class PgStatement {
  constructor(private conn: string, private sql: string, private params: unknown[] = []) {}

  bind(...params: unknown[]): PgStatement {
    return new PgStatement(this.conn, this.sql, params);
  }

  async all<T = Row>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
    const r = await neonQuery(this.conn, toPgPlaceholders(this.sql), this.params);
    return { results: r.rows as T[], success: true, meta: { changes: r.rowCount ?? 0 } };
  }

  async first<T = Row>(): Promise<T | null> {
    const { results } = await this.all<T>();
    return results[0] ?? null;
  }

  async run(): Promise<{ success: true; meta: { last_row_id: number; changes: number } }> {
    let sql = toPgPlaceholders(this.sql);
    const wantId = HAS_ID.test(sql) && !/\bRETURNING\b/i.test(sql);
    if (wantId) sql = sql.replace(/;\s*$/, '') + ' RETURNING id';
    const r = await neonQuery(this.conn, sql, this.params);
    const id = wantId && r.rows[0] ? Number(r.rows[0].id) : 0;
    return { success: true, meta: { last_row_id: id, changes: r.rowCount ?? 0 } };
  }
}

/** D1Database 자리에 끼워 넣는 객체 */
export class PgDatabase {
  readonly dialect = 'pg';
  constructor(private conn: string) {}
  prepare(sql: string): PgStatement { return new PgStatement(this.conn, sql); }
}
