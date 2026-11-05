const { loadConfig } = require('./config/env');
const { createPool } = require('./config/database');
const { createApp } = require('./app');
const config = loadConfig();
const db = createPool(config);
db.on('error', error => { console.error('Unexpected idle database connection error', error); });
const app = createApp({ db, config });
const server = app.listen(config.port, () => console.log('API listening on port ' + config.port));
server.requestTimeout = 30000;
server.headersTimeout = 35000;
let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(signal + ': shutting down');
  const timeout = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000);
  timeout.unref();
  server.close(async () => {
    await db.end();
    clearTimeout(timeout);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
