-- Keep only commit history from 2026-05-01 00:00:00 Asia/Tokyo onward.
-- Records whose period starts before the cutoff include either only old data or
-- the boundary week; the latter is rebuilt from the retained commits on sync.
DELETE FROM change_records
WHERE period_start < '2026-04-30T15:00:00.000Z';

DELETE FROM commits
WHERE committed_at < '2026-04-30T15:00:00.000Z';

UPDATE repositories
SET last_synced_at = NULL
WHERE deleted_at IS NULL;

CREATE TRIGGER commits_data_cutoff_insert
BEFORE INSERT ON commits
WHEN NEW.committed_at < '2026-04-30T15:00:00.000Z'
BEGIN
  SELECT RAISE(ABORT, 'Commit predates the data cutoff');
END;

CREATE TRIGGER commits_data_cutoff_update
BEFORE UPDATE OF committed_at ON commits
WHEN NEW.committed_at < '2026-04-30T15:00:00.000Z'
BEGIN
  SELECT RAISE(ABORT, 'Commit predates the data cutoff');
END;
