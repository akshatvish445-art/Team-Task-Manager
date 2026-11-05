const { loadConfig } = require("../src/config/env");
const valid = {
  DATABASE_URL: "postgresql://localhost/tracker",
  JWT_SECRET: "a-random-secret-with-at-least-32-characters",
};
test("config validates secrets, ports, bcrypt cost and TLS", () => {
  expect(loadConfig(valid)).toMatchObject({
    port: 3000,
    bcryptRounds: 12,
    databaseSsl: false,
  });
  expect(loadConfig({ ...valid, DATABASE_SSL: "true" }).databaseSsl).toBe(true);
  for (const patch of [
    { JWT_SECRET: "short" },
    { PORT: "0" },
    { BCRYPT_ROUNDS: "4" },
    { DATABASE_SSL: "yes" },
    { JWT_EXPIRES_IN: "bad" },
    { JWT_SECRET: "replace-this-with-a-long-random-secret" },
  ]) {
    expect(() => loadConfig({ ...valid, ...patch })).toThrow();
  }
});
