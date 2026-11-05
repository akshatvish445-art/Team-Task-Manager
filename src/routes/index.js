const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { authenticate } = require('../middleware/auth');
const { schemas: s, validate: v } = require('../validators');
function createRoutes(controllers, config, db) {
  const router = Router();
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts. Try again later.', request_id: req.requestId } }),
  });
  router.post('/auth/register', authLimit, v(s.register), controllers.register);
  router.post('/auth/login', authLimit, v(s.login), controllers.login);
  router.use(authenticate(config, db));
  router.post('/projects', v(s.project), controllers.createProject);
  router.get('/projects', controllers.listProjects);
  router.get('/projects/:projectId', v(s.projectId, 'params'), controllers.getProject);
  router.post('/projects/:projectId/members', v(s.projectId, 'params'), v(s.member), controllers.addMember);
  router.delete('/projects/:projectId', v(s.projectId, 'params'), controllers.deleteProject);
  router.post('/projects/:projectId/tasks', v(s.projectId, 'params'), v(s.task), controllers.createTask);
  router.get('/projects/:projectId/tasks', v(s.projectId, 'params'), v(s.taskQuery, 'query'), controllers.listTasks);
  router.patch('/tasks/:taskId', v(s.taskId, 'params'), v(s.taskUpdate), controllers.updateTask);
  router.delete('/tasks/:taskId', v(s.taskId, 'params'), controllers.deleteTask);
  router.get('/projects/:projectId/summary', v(s.projectId, 'params'), controllers.summary);
  return router;
}
module.exports = { createRoutes };
