CREATE TABLE users (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  email varchar(254) NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE projects (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name varchar(200) NOT NULL CHECK (length(trim(name)) > 0),
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_members (
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- Every owner must be a member; deferral allows both rows to be created atomically.
ALTER TABLE projects ADD CONSTRAINT projects_owner_membership_fk
  FOREIGN KEY (id, owner_id) REFERENCES project_members(project_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE tasks (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL CHECK (length(trim(title)) > 0),
  description text CHECK (length(description) <= 10000),
  status text NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
  priority text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  assignee_id integer,
  created_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, assignee_id) REFERENCES project_members(project_id, user_id),
  FOREIGN KEY (project_id, created_by) REFERENCES project_members(project_id, user_id),
  CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);

CREATE INDEX project_members_user_project_idx ON project_members(user_id, project_id);
CREATE INDEX projects_owner_idx ON projects(owner_id);
CREATE INDEX tasks_project_created_idx ON tasks(project_id, created_at, id);
CREATE INDEX tasks_project_due_idx ON tasks(project_id, due_date, id);
CREATE INDEX tasks_project_status_idx ON tasks(project_id, status);
CREATE INDEX tasks_project_priority_idx ON tasks(project_id, priority);
CREATE INDEX tasks_project_assignee_idx ON tasks(project_id, assignee_id);
CREATE INDEX tasks_creator_idx ON tasks(created_by);
