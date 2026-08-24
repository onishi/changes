PRAGMA foreign_keys = ON;

CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  full_name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private', 'internal')),
  html_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_fork INTEGER NOT NULL DEFAULT 0 CHECK (is_fork IN (0, 1)),
  github_updated_at TEXT,
  last_synced_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_login, name)
);

CREATE INDEX repositories_visibility_idx
  ON repositories (visibility, deleted_at, name);

CREATE TABLE commits (
  repository_id TEXT NOT NULL,
  oid TEXT NOT NULL,
  message_headline TEXT NOT NULL,
  message_body TEXT,
  committed_at TEXT NOT NULL,
  author_github_user_id TEXT,
  author_login TEXT,
  html_url TEXT NOT NULL,
  is_merge INTEGER NOT NULL DEFAULT 0 CHECK (is_merge IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repository_id, oid),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX commits_period_idx
  ON commits (repository_id, committed_at DESC, oid);

CREATE INDEX commits_author_idx
  ON commits (author_github_user_id, committed_at DESC);

CREATE TABLE change_records (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('public', 'all')),
  period_type TEXT NOT NULL CHECK (period_type IN ('daily', 'weekly', 'monthly')),
  period_key TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  commit_count INTEGER NOT NULL DEFAULT 0,
  first_committed_at TEXT NOT NULL,
  last_committed_at TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  summary_text TEXT,
  summary_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (summary_status IN ('pending', 'generating', 'ready', 'failed')),
  summary_model TEXT,
  prompt_version TEXT,
  generated_at TEXT,
  summary_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (scope, period_type, period_start, repository_id),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX change_records_period_idx
  ON change_records (
    scope,
    period_type,
    period_start,
    last_committed_at DESC,
    repository_id
  );

CREATE INDEX change_records_repository_idx
  ON change_records (
    scope,
    repository_id,
    period_type,
    period_start DESC
  );

CREATE INDEX change_records_summary_idx
  ON change_records (summary_status, updated_at);

CREATE TABLE change_record_commits (
  change_record_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  commit_oid TEXT NOT NULL,
  PRIMARY KEY (change_record_id, repository_id, commit_oid),
  FOREIGN KEY (change_record_id) REFERENCES change_records(id) ON DELETE CASCADE,
  FOREIGN KEY (repository_id, commit_oid)
    REFERENCES commits(repository_id, oid) ON DELETE CASCADE
);

CREATE INDEX change_record_commits_commit_idx
  ON change_record_commits (repository_id, commit_oid);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX oauth_states_expires_idx ON oauth_states (expires_at);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  repositories_seen INTEGER NOT NULL DEFAULT 0,
  commits_seen INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE INDEX sync_runs_started_idx ON sync_runs (started_at DESC);
