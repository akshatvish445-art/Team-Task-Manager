const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig } = require('../src/config/env');
const { createPool } = require('../src/config/database');
async function migrate(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(72741001)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = path.join(__dirname, '..', 'migrations');
    const names = (await fs.readdir(directory)).filter(n => /^\d+.*\.sql$/.test(n)).sort();
    for (const name of names) {
      const sql = await fs.readFile(path.join(directory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const prior = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (prior.rows.length) {
        if (prior.rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + name);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
if (require.main === module) {
  const pool = createPool(loadConfig());
  migrate(pool).then(() => console.log('Migrations applied.')).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
}
module.exports = { migrate };
