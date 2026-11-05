const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ApiError } = require('../errors');
const notFound = resource => new ApiError(404, 'NOT_FOUND', resource + ' not found.');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
function createService(store, config) {
  // A fixed valid hash makes unknown-account login perform the same expensive bcrypt operation.
  const dummyHash = bcrypt.hashSync('dummy-password-for-timing', config.bcryptRounds);
  async function member(tx, projectId, userId) {
    const result = await tx.query(
      'SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE p.id = $1 AND m.user_id = $2',
      [projectId, userId]);
    if (!result.rows.length) throw notFound('Project');
    return result.rows[0];
  }
  async function assignee(tx, projectId, assigneeId) {
    if (assigneeId == null) return;
    const result = await tx.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, assigneeId]);
    if (!result.rows.length) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Assignee must be a member of this project.');
  }
  async function taskForMember(tx, taskId, userId) {
    const result = await tx.query(
      'SELECT t.*, p.owner_id FROM tasks t JOIN projects p ON p.id = t.project_id ' +
      'JOIN project_members m ON m.project_id = t.project_id WHERE t.id = $1 AND m.user_id = $2 FOR UPDATE OF t',
      [taskId, userId]);
    if (!result.rows.length) throw notFound('Task');
    return result.rows[0];
  }
  return {
    async register(input) {
      const hash = await bcrypt.hash(input.password, config.bcryptRounds);
      try {
        const result = await store.query(
          'INSERT INTO users(name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
          [input.name, input.email, hash]);
        return result.rows[0];
      } catch (error) {
        if (error.code === '23505') throw new ApiError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
        throw error;
      }
    },
    async login(input) {
      const result = await store.query('SELECT id, name, email, password_hash, created_at FROM users WHERE lower(email) = lower($1)', [input.email]);
      const user = result.rows[0];
      const valid = await bcrypt.compare(input.password, user ? user.password_hash : dummyHash);
      if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      const token = jwt.sign({}, config.jwtSecret, {
        algorithm: 'HS256', subject: String(user.id), issuer: 'team-task-tracker',
        audience: 'team-task-tracker-api', expiresIn: config.jwtExpiresIn,
      });
      delete user.password_hash;
      return { access_token: token, token_type: 'Bearer', user };
    },
    async createProject(userId, input) {
      return store.transaction(async tx => {
        const result = await tx.query('INSERT INTO projects(name, owner_id) VALUES ($1, $2) RETURNING *', [input.name, userId]);
        const project = result.rows[0];
        await tx.query('INSERT INTO project_members(project_id, user_id) VALUES ($1, $2)', [project.id, userId]);
        return project;
      });
    },
    async listProjects(userId) {
      const result = await store.query(
        'SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id WHERE m.user_id = $1 ORDER BY p.created_at DESC, p.id DESC', [userId]);
      return result.rows;
    },
    async getProject(userId, projectId) { return member(store, projectId, userId); },
    async addMember(userId, projectId, input) {
      return store.transaction(async tx => {
        const project = await member(tx, projectId, userId);
        if (project.owner_id !== userId) throw forbidden();
        const users = await tx.query('SELECT id, name, email FROM users WHERE lower(email) = lower($1)', [input.email]);
        if (!users.rows.length) throw new ApiError(404, 'USER_NOT_FOUND', 'No registered user has this email.');
        const user = users.rows[0];
        const result = await tx.query(
          'INSERT INTO project_members(project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING joined_at', [projectId, user.id]);
        if (!result.rows.length) throw new ApiError(409, 'ALREADY_MEMBER', 'User is already a project member.');
        return { project_id: projectId, user, joined_at: result.rows[0].joined_at };
      });
    },
    async deleteProject(userId, projectId) {
      return store.transaction(async tx => {
        const project = await member(tx, projectId, userId);
        if (project.owner_id !== userId) throw forbidden();
        await tx.query('DELETE FROM projects WHERE id = $1', [projectId]);
      });
    },
    async createTask(userId, projectId, input) {
      return store.transaction(async tx => {
        await member(tx, projectId, userId);
        await assignee(tx, projectId, input.assignee_id);
        const result = await tx.query(
          'INSERT INTO tasks(project_id, title, description, status, priority, assignee_id, created_by, due_date, completed_at) ' +
          "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $4 = 'DONE' THEN clock_timestamp() ELSE NULL END) RETURNING *",
          [projectId, input.title, input.description ?? null, input.status ?? 'TODO', input.priority ?? 'MEDIUM', input.assignee_id ?? null, userId, input.due_date ?? null]);
        return result.rows[0];
      });
    },
    async listTasks(userId, projectId, filters) {
      await member(store, projectId, userId);
      const result = await store.listTasks(projectId, filters);
      const totalPages = Math.ceil(result.total / filters.page_size);
      return { data: result.tasks, pagination: { page: filters.page, page_size: filters.page_size, total: result.total, total_pages: totalPages, has_next: filters.page < totalPages } };
    },
    async updateTask(userId, taskId, input) {
      return store.transaction(async tx => {
        const task = await taskForMember(tx, taskId, userId);
        await assignee(tx, task.project_id, input.assignee_id);
        // Only editable fields are mapped here; no request-controlled SQL identifiers.
        const values = [taskId];
        const clauses = [];
        for (const key of ['title', 'description', 'status', 'priority', 'assignee_id', 'due_date']) {
          if (Object.hasOwn(input, key)) {
            values.push(input[key]);
            clauses.push(key + ' = $' + values.length);
          }
        }
        const nextStatus = input.status ?? task.status;
        if (nextStatus !== 'DONE') clauses.push('completed_at = NULL');
        else if (task.status !== 'DONE') clauses.push('completed_at = clock_timestamp()');
        // DONE -> DONE preserves the existing completion instant.
        clauses.push("updated_at = GREATEST(clock_timestamp(), updated_at + interval '1 microsecond')");
        const result = await tx.query('UPDATE tasks SET ' + clauses.join(', ') + ' WHERE id = $1 RETURNING *', values);
        return result.rows[0];
      });
    },
    async deleteTask(userId, taskId) {
      return store.transaction(async tx => {
        const task = await taskForMember(tx, taskId, userId);
        if (task.owner_id !== userId && task.created_by !== userId) throw forbidden();
        await tx.query('DELETE FROM tasks WHERE id = $1', [taskId]);
      });
    },
    async summary(userId, projectId) {
      await member(store, projectId, userId);
      const result = await store.query(
        "SELECT count(*)::integer AS total, count(*) FILTER (WHERE status = 'TODO')::integer AS todo, " +
        "count(*) FILTER (WHERE status = 'IN_PROGRESS')::integer AS in_progress, count(*) FILTER (WHERE status = 'DONE')::integer AS done, " +
        "count(*) FILTER (WHERE priority = 'LOW')::integer AS low, count(*) FILTER (WHERE priority = 'MEDIUM')::integer AS medium, " +
        "count(*) FILTER (WHERE priority = 'HIGH')::integer AS high FROM tasks WHERE project_id = $1", [projectId]);
      const row = result.rows[0];
      return { total: row.total, by_status: { TODO: row.todo, IN_PROGRESS: row.in_progress, DONE: row.done }, by_priority: { LOW: row.low, MEDIUM: row.medium, HIGH: row.high } };
    },
  };
}
module.exports = { createService };
