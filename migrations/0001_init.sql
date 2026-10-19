-- 핑거 IR 뉴스 클리핑 스키마

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  severity TEXT NOT NULL DEFAULT '확인 필요',      -- 상 | 중 | 하 | 확인 필요
  severity_code TEXT,                              -- H1..L1
  severity_ai TEXT,                                -- AI 제안값(수동 설정 시 병기)
  severity_manual INTEGER NOT NULL DEFAULT 0,      -- 1이면 수동 설정값 보존
  status TEXT NOT NULL DEFAULT '신규',             -- 신규 | 진행 | 완료
  suggested_action TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  media TEXT DEFAULT '',                           -- 관련 매체(· 구분)
  legacy_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  url_norm TEXT NOT NULL,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  summary TEXT DEFAULT '',
  publisher TEXT DEFAULT '',
  published_at TEXT,                               -- ISO8601
  source TEXT DEFAULT '',                          -- 수집 소스명
  tone TEXT NOT NULL DEFAULT '미분류',             -- 우호 | 중립 | 공격 | 미분류
  tone_by TEXT NOT NULL DEFAULT 'rule',            -- ai | rule | manual | legacy
  severity TEXT NOT NULL DEFAULT '확인 필요',
  severity_code TEXT,
  confidence REAL DEFAULT 0,
  ai_summary TEXT DEFAULT '',
  evidence TEXT DEFAULT '',
  issue_id INTEGER REFERENCES issues(id),
  legacy_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_articles_url_norm ON articles(url_norm);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_issue ON articles(issue_id);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL DEFAULT 'cron',            -- cron | manual
  started_at TEXT NOT NULL,
  finished_at TEXT,
  candidates INTEGER DEFAULT 0,
  filtered INTEGER DEFAULT 0,
  duplicates INTEGER DEFAULT 0,
  imported INTEGER DEFAULT 0,
  classified INTEGER DEFAULT 0,
  feeds TEXT DEFAULT '[]',                         -- JSON
  errors TEXT DEFAULT '[]'                         -- JSON
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publisher TEXT NOT NULL,
  relation TEXT DEFAULT '',
  status TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
