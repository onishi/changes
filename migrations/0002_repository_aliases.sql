CREATE TABLE repository_aliases (
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  repository_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_login, name),
  FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
);

CREATE INDEX repository_aliases_repository_idx
  ON repository_aliases (repository_id);
