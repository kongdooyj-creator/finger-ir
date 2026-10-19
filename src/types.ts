export interface Env {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  AI_MODEL: string;
  AI_MODEL_FALLBACK: string;
  MAX_CLASSIFY_PER_RUN: string;
  ADMIN_TOKEN?: string;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
}

export type Tone = '우호' | '중립' | '공격' | '미분류';
export type Severity = '상' | '중' | '하' | '확인 필요';
export type IssueStatus = '신규' | '진행' | '완료';

export const TONES: Tone[] = ['우호', '중립', '공격', '미분류'];
export const SEVERITIES: Severity[] = ['상', '중', '하', '확인 필요'];
export const STATUSES: IssueStatus[] = ['신규', '진행', '완료'];

export const SEVERITY_RANK: Record<Severity, number> = { '상': 3, '중': 2, '하': 1, '확인 필요': 0 };

/** 수집 단계에서 만들어지는 기사 후보 */
export interface Candidate {
  url: string;
  title: string;
  summary: string;
  publisher: string;
  publishedAt: string | null; // ISO
  source: string;
}

export interface Classification {
  tone: Tone;
  severity: Severity;
  severity_code: string | null;
  confidence: number;
  summary: string;
  evidence: string;
  by: 'ai' | 'rule';
}

export interface IssueRow {
  id: number;
  title: string;
  summary: string;
  severity: Severity;
  severity_code: string | null;
  severity_ai: string | null;
  severity_manual: number;
  status: IssueStatus;
  suggested_action: string;
  memo: string;
  media: string;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleRow {
  id: number;
  url: string;
  url_norm: string;
  title: string;
  title_norm: string;
  summary: string;
  publisher: string;
  published_at: string | null;
  source: string;
  tone: Tone;
  tone_by: string;
  severity: Severity;
  severity_code: string | null;
  confidence: number;
  ai_summary: string;
  evidence: string;
  issue_id: number | null;
  legacy_id: string | null;
  created_at: string;
}

export interface FeedResult {
  source: string;
  url: string;
  status: 'ok' | 'error' | 'skipped';
  found: number;
  error?: string;
}
