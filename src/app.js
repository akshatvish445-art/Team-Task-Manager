const express = require('express');
const helmet = require('helmet');
const { randomUUID } = require('node:crypto');
const { createStore } = require('./repositories/store');
const { createService } = require('./services/tracker');
const { createControllers } = require('./controllers');
const { createRoutes } = require('./routes');
const { errorHandler } = require('./middleware/errors');
const { ApiError } = require('./errors');
function createApp({ db, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ data: { status: 'ok' } });
  });
  const service = createService(createStore(db), config);
  app.use(createRoutes(createControllers(service), config, db));
  app.use((req, res, next) => next(new ApiError(404, 'NOT_FOUND', 'Route not found.')));
  app.use(errorHandler(logger));
  return app;
}
module.exports = { createApp };
