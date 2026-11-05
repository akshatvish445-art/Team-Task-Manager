const dotenv = require('dotenv');
const { z } = require('zod');
dotenv.config({ quiet: true });
function loadConfig(env = process.env) {
  const parsed = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().startsWith('postgres'),
    DATABASE_SSL: z.enum(['true', 'false']).default('false'),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('1h'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  }).safeParse(env);
  if (!parsed.success) throw new Error('Invalid configuration: ' + parsed.error.issues.map(i => i.path.join('.') + ' ' + i.message).join('; '));
  const c = parsed.data;
  if (c.JWT_SECRET.startsWith('replace-this')) throw new Error('Replace the example JWT_SECRET before starting');
  return {
    nodeEnv: c.NODE_ENV, port: c.PORT, databaseUrl: c.DATABASE_URL,
    databaseSsl: c.DATABASE_SSL === 'true', jwtSecret: c.JWT_SECRET,
    jwtExpiresIn: c.JWT_EXPIRES_IN, bcryptRounds: c.BCRYPT_ROUNDS,
  };
}
module.exports = { loadConfig };
