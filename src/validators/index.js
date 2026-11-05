const { z } = require('zod');
const { ApiError } = require('../errors');
const id = z.number().int().positive().max(2147483647);
const paramId = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(id);
const email = z.string().trim().max(254).email().transform(v => v.toLowerCase());
const password = z.string().min(8).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes.');
const date = z.iso.date();
const status = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
const priority = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const taskFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullable().optional(),
  status: status.optional(), priority: priority.optional(),
  assignee_id: id.nullable().optional(), due_date: date.nullable().optional(),
};
const schemas = {
  register: z.strictObject({ name: z.string().trim().min(1).max(120), email, password }),
  login: z.strictObject({ email, password: z.string().min(1).refine(v => Buffer.byteLength(v, 'utf8') <= 72) }),
  project: z.strictObject({ name: z.string().trim().min(1).max(200) }),
  member: z.strictObject({ email }),
  task: z.strictObject(taskFields),
  taskUpdate: z.strictObject(taskFields).partial().refine(v => Object.keys(v).length > 0, 'Supply at least one task field.'),
  projectId: z.strictObject({ projectId: paramId }),
  taskId: z.strictObject({ taskId: paramId }),
  taskQuery: z.strictObject({
    status: status.optional(), priority: priority.optional(),
    assignee_id: paramId.optional(),
    due_date_from: date.optional(), due_date_to: date.optional(),
    sort_by: z.enum(['created_at', 'due_date']).default('created_at'),
    sort_order: z.enum(['asc', 'desc']).default('desc'),
    page: paramId.default(1),
    page_size: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(50)).default(10),
  }).refine(v => !v.due_date_from || !v.due_date_to || v.due_date_from <= v.due_date_to, 'due_date_from must be on or before due_date_to.'),
};
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid request data.', parsed.error.issues.map(i => ({ field: i.path.join('.'), message: i.message })));
    req.validated ||= {};
    req.validated[source] = parsed.data;
    next();
  };
}
module.exports = { schemas, validate };
