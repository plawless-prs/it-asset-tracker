-- =============================================================================
-- PRS Apps — Price Update Processor  [batch-delete performance indexes]
-- Run once in the Supabase SQL Editor. Idempotent / additive. Safe to re-run.
--
-- Deleting a batch cascades pu_batches -> pu_batch_files -> pu_lines(file_id),
-- and pu_lines.file_id had no index — so EVERY cascaded file-row delete
-- seq-scanned the whole pu_lines table. With a few large batches in the
-- system that pushed batch deletion past the statement timeout ("canceling
-- statement due to statement timeout" on Delete batch, 2026-09-02). Same
-- story for the other unindexed FK hops the cascade touches.
-- =============================================================================

create index if not exists idx_pu_lines_file on pu_lines (file_id);
create index if not exists idx_pu_batch_files_batch on pu_batch_files (batch_id);
create index if not exists idx_pu_exports_batch on pu_exports (batch_id);
create index if not exists idx_pu_library_files_batch on pu_library_files (batch_id);

-- =============================================================================
-- Done. Verify: deleting a parsed batch from the UI completes in ~a second.
-- =============================================================================
