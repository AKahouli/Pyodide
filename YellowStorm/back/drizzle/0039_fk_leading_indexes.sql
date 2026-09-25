-- Leading indexes for the user/connector/run foreign keys that 0033 (knowledge intelligence) and 0034
-- (classifier) declared without one, found by db:verify check4 once those schemas joined its list.
-- Without them, deleting a user (or a connector or run) scans the whole child table for every FK check.
-- Numbered 0039 after 0038_worky; a new file, because 0033/0034 may already be applied elsewhere.
SET LOCAL lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_knowledge_alerts_acknowledged_by ON governance.knowledge_alerts (acknowledged_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_extraction_jobs_connector ON governance.knowledge_extraction_jobs (connector_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_extraction_jobs_requested_by ON governance.knowledge_extraction_jobs (requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_recommendations_decided_by ON governance.knowledge_recommendations (decided_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_recommendations_applied_by ON governance.knowledge_recommendations (applied_by);
CREATE INDEX IF NOT EXISTS idx_metadata_candidates_decided_by ON governance.metadata_candidates (decided_by);
CREATE INDEX IF NOT EXISTS idx_temporal_candidate_records_decided_by ON governance.temporal_candidate_records (decided_by);

CREATE INDEX IF NOT EXISTS idx_classifier_folders_created_by ON classifier.folders (created_by);
CREATE INDEX IF NOT EXISTS idx_classifier_runs_triggered_by ON classifier.runs (triggered_by);
CREATE INDEX IF NOT EXISTS idx_classifier_assignments_run ON classifier.file_assignments (classification_run_id);
CREATE INDEX IF NOT EXISTS idx_classifier_assignments_assigned_by ON classifier.file_assignments (assigned_by);
