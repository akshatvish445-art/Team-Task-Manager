const jwt = require('jsonwebtoken');
const { ApiError } = require('../errors');
function authenticate(config, db) {
  return async (req, res, next) => {
    const match = /^Bearer ([^ ]+)$/i.exec(req.get('authorization') || '');
    if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid Bearer access token is required.');
    let payload;
    try {
      payload = jwt.verify(match[1], config.jwtSecret, {
        algorithms: ['HS256'], issuer: 'team-task-tracker', audience: 'team-task-tracker-api',
      });
      if (typeof payload !== 'object' || !/^[1-9]\d*$/.test(payload.sub) || !Number.isSafeInteger(Number(payload.sub)) || Number(payload.sub) > 2147483647) throw new Error('Invalid subject');
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'A valid Bearer access token is required.');
    }
    const result = await db.query('SELECT id FROM users WHERE id = $1', [payload.sub]);
    if (!result.rows.length) throw new ApiError(401, 'UNAUTHENTICATED', 'A valid Bearer access token is required.');
    req.userId = result.rows[0].id;
    next();
  };
}
module.exports = { authenticate };
