-- Merge commits record a merge rather than a change: the commits they bring in
-- are already reachable on the default branch and carry the actual work, so
-- keeping them only inflates commit counts and adds noise to the summaries.
-- change_record_commits rows cascade from commits.
DELETE FROM commits
WHERE is_merge = 1;

-- A period whose only commit was a merge has nothing left to show. Periods that
-- still have commits keep their summary and are rebuilt by the sync below.
DELETE FROM change_records
WHERE NOT EXISTS (
  SELECT 1 FROM change_record_commits
  WHERE change_record_commits.change_record_id = change_records.id
);

-- Commits used to be fetched with an author filter, so commits written by
-- co-maintainers and by AI were never stored. Clearing last_synced_at makes the
-- next sync start from the data cutoff again and pick them up, which also
-- repairs the counts and summaries of the records the delete above touched.
UPDATE repositories
SET last_synced_at = NULL
WHERE deleted_at IS NULL;

CREATE TRIGGER commits_no_merge_insert
BEFORE INSERT ON commits
WHEN NEW.is_merge = 1
BEGIN
  SELECT RAISE(ABORT, 'Merge commits are not stored');
END;

CREATE TRIGGER commits_no_merge_update
BEFORE UPDATE OF is_merge ON commits
WHEN NEW.is_merge = 1
BEGIN
  SELECT RAISE(ABORT, 'Merge commits are not stored');
END;
