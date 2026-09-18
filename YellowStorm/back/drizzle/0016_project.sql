CREATE SCHEMA IF NOT EXISTS project;

CREATE TABLE IF NOT EXISTS project.projects (
  id          char(24) PRIMARY KEY,
  name        varchar(100) NOT NULL,
  created_by  char(24)     NOT NULL,
  is_public   boolean      NOT NULL DEFAULT false,
  share_count integer      NOT NULL DEFAULT 0,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_owner_name ON project.projects (created_by, name);
CREATE INDEX IF NOT EXISTS idx_projects_owner_created   ON project.projects (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS project.project_shares (
  id                  char(24)    PRIMARY KEY,
  project_id          char(24)    NOT NULL REFERENCES project.projects(id) ON DELETE CASCADE,
  owner_id            char(24)    NOT NULL,
  shared_with_user_id char(24)    NOT NULL,
  permission          varchar(16) NOT NULL CHECK (permission IN ('read','readwrite')),
  shared_by           char(24)    NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_shares_project_user ON project.project_shares (project_id, shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_project_shares_user_created    ON project.project_shares (shared_with_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_shares_project_created ON project.project_shares (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_shares_owner           ON project.project_shares (owner_id);
