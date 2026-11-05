function createControllers(service) {
  return {
    register: async (req, res) => res.status(201).json({ data: await service.register(req.validated.body) }),
    login: async (req, res) => res.json({ data: await service.login(req.validated.body) }),
    createProject: async (req, res) => res.status(201).json({ data: await service.createProject(req.userId, req.validated.body) }),
    listProjects: async (req, res) => res.json({ data: await service.listProjects(req.userId) }),
    getProject: async (req, res) => res.json({ data: await service.getProject(req.userId, req.validated.params.projectId) }),
    addMember: async (req, res) => res.status(201).json({ data: await service.addMember(req.userId, req.validated.params.projectId, req.validated.body) }),
    deleteProject: async (req, res) => { await service.deleteProject(req.userId, req.validated.params.projectId); res.status(204).end(); },
    createTask: async (req, res) => res.status(201).json({ data: await service.createTask(req.userId, req.validated.params.projectId, req.validated.body) }),
    listTasks: async (req, res) => res.json(await service.listTasks(req.userId, req.validated.params.projectId, req.validated.query)),
    updateTask: async (req, res) => res.json({ data: await service.updateTask(req.userId, req.validated.params.taskId, req.validated.body) }),
    deleteTask: async (req, res) => { await service.deleteTask(req.userId, req.validated.params.taskId); res.status(204).end(); },
    summary: async (req, res) => res.json({ data: await service.summary(req.userId, req.validated.params.projectId) }),
  };
}
module.exports = { createControllers };
