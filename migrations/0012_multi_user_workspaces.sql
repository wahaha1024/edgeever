PRAGMA foreign_keys = ON;

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  is_personal INTEGER NOT NULL DEFAULT 1 CHECK (is_personal IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_workspace_members_personal_user
  ON workspace_members(user_id);

CREATE INDEX idx_workspace_members_workspace
  ON workspace_members(workspace_id, role);

CREATE UNIQUE INDEX idx_workspace_single_owner
  ON workspace_members(workspace_id)
  WHERE role = 'owner';

INSERT INTO workspaces (id, name, is_personal)
VALUES ('ws_default', 'Personal workspace', 1);

-- Existing EdgeEver instances were single-user. Their first enabled user owns
-- the legacy workspace; if no user exists yet, the login bootstrap claims it.
INSERT OR IGNORE INTO workspace_members (workspace_id, user_id, role)
SELECT 'ws_default', id, 'owner'
FROM users
WHERE is_disabled = 0
ORDER BY created_at ASC
LIMIT 1;

ALTER TABLE notebooks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE memos ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';
ALTER TABLE api_tokens ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_default';

CREATE INDEX idx_notebooks_workspace_parent
  ON notebooks(workspace_id, parent_id, is_deleted, sort_order, name);

CREATE INDEX idx_memos_workspace_notebook_feed
  ON memos(workspace_id, notebook_id, is_deleted, updated_at DESC);

CREATE INDEX idx_memos_workspace_archive_feed
  ON memos(workspace_id, is_archived, is_deleted, updated_at DESC);

CREATE INDEX idx_api_tokens_workspace
  ON api_tokens(workspace_id, is_revoked, created_at DESC);
