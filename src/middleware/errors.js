const { ApiError } = require('../errors');
function errorHandler(logger = console) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    let error = err;
    if (err.type === 'entity.parse.failed') error = new ApiError(400, 'INVALID_JSON', 'Request body contains malformed JSON.');
    if (err.type === 'entity.too.large') error = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 32 KB.');
    if (!(error instanceof ApiError)) {
      logger.error({ requestId: req.requestId, error: err });
      error = new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
    }
    const body = { code: error.code, message: error.message, request_id: req.requestId };
    if (error.details) body.details = error.details;
    res.status(error.status).json({ error: body });
  };
}
module.exports = { errorHandler };
