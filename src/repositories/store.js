// All client-supplied values are bound parameters. SQL identifiers are allowlisted below.
function createStore(db) {
  return {
    query: (sql, values) => db.query(sql, values),
    async transaction(work) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const result = await work(createStore(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally { client.release(); }
    },
    async listTasks(projectId, filters) {
      const values = [projectId];
      const clauses = ['project_id = $1'];
      for (const [key, op] of [['status', '='], ['priority', '='], ['assignee_id', '='], ['due_date_from', '>='], ['due_date_to', '<=']]) {
        if (filters[key] !== undefined) {
          values.push(filters[key]);
          const column = key.startsWith('due_date_') ? 'due_date' : key;
          clauses.push(column + ' ' + op + ' $' + values.length);
        }
      }
      const where = clauses.join(' AND ');
      const sortColumn = filters.sort_by === 'due_date' ? 'due_date' : 'created_at';
      const direction = filters.sort_order === 'asc' ? 'ASC' : 'DESC';
      // One statement produces a consistent count and page even during concurrent writes.
      const result = await db.query(
        'WITH filtered AS (SELECT * FROM tasks WHERE ' + where + '), paged AS (' +
        'SELECT * FROM filtered ORDER BY ' + sortColumn + ' ' + direction + ' NULLS LAST, id ' + direction +
        ' LIMIT $' + (values.length + 1) + ' OFFSET $' + (values.length + 2) +
        ') SELECT (SELECT count(*)::integer FROM filtered) AS total, ' +
        "COALESCE((SELECT json_agg(paged) FROM paged), '[]'::json) AS tasks",
        [...values, filters.page_size, (filters.page - 1) * filters.page_size]);
      return result.rows[0];
    },
  };
}
module.exports = { createStore };
