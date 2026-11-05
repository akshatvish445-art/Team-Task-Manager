const { Pool } = require('pg');
function createPool(config) {
  return new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
  });
}
module.exports = { createPool };
