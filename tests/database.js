const { Pool } = require("pg");
const { migrate } = require("../scripts/migrate");
async function testDatabase() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "Set TEST_DATABASE_URL to a dedicated PostgreSQL database ending in _test.",
    );
  }
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  // Refuse destructive fixture cleanup unless an explicitly named test DB was supplied.
  const result = await pool.query("SELECT current_database() AS name");
  if (!result.rows[0].name.endsWith("_test")) {
    await pool.end();
    throw new Error(
      "TEST_DATABASE_URL must reference a dedicated database ending in _test.",
    );
  }
  await migrate(pool);
  await migrate(pool); // An unchanged migration must be idempotent.
  return { db: pool, close: () => pool.end() };
}
module.exports = { testDatabase };
