const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { createApp } = require("../src/app");
const { testDatabase } = require("./database");

const config = {
  nodeEnv: "test",
  jwtSecret: "test-only-secret-at-least-32-characters",
  jwtExpiresIn: "1h",
  bcryptRounds: 10,
};
const logger = { error: jest.fn() };
let app, fixture, db, owner, member, outsider, third, project;
async function account(email) {
  const response = await request(app)
    .post("/auth/register")
    .send({ name: email.split("@")[0], email, password: "password123" })
    .expect(201);
  const login = await request(app)
    .post("/auth/login")
    .send({ email, password: "password123" })
    .expect(200);
  return { ...response.body.data, token: login.body.data.access_token };
}
const as = (method, url, user = owner) =>
  request(app)
    [method](url)
    .set("Authorization", "Bearer " + user.token);
const createTask = async (body = {}, user = member) => {
  const response = await as("post", "/projects/" + project.id + "/tasks", user)
    .send({ title: "Task", ...body })
    .expect(201);
  return response.body.data;
};
beforeAll(async () => {
  fixture = await testDatabase();
  db = fixture.db;
  app = createApp({ db, config, logger });
  owner = await account("owner@example.com");
  member = await account("member@example.com");
  outsider = await account("outsider@example.com");
  third = await account("third@example.com");
});
beforeEach(async () => {
  await db.query(
    "TRUNCATE projects, project_members, tasks RESTART IDENTITY CASCADE",
  );
  const response = await as("post", "/projects")
    .send({ name: "Project" })
    .expect(201);
  project = response.body.data;
  await as("post", "/projects/" + project.id + "/members")
    .send({ email: member.email })
    .expect(201);
});
afterAll(async () => {
  if (fixture) await fixture.close();
});

describe("authentication", () => {
  test("hashes passwords, normalizes email, and never exposes hashes", async () => {
    const response = await request(app)
      .post("/auth/register")
      .send({
        name: "Alice",
        email: "ALICE@example.com",
        password: "password123",
      })
      .expect(201);
    expect(response.body.data.email).toBe("alice@example.com");
    expect(JSON.stringify(response.body)).not.toMatch(/password/);
    const result = await db.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [response.body.data.id],
    );
    expect(result.rows[0].password_hash).not.toBe("password123");
    expect(
      await bcrypt.compare("password123", result.rows[0].password_hash),
    ).toBe(true);
    await request(app)
      .post("/auth/register")
      .send({
        name: "Alice",
        email: "Alice@EXAMPLE.com",
        password: "password123",
      })
      .expect(409);
  });
  test.each([
    {},
    { name: "A", email: "bad", password: "password123" },
    { name: "A", email: "a@example.com", password: "short" },
    { name: "A", email: "a@example.com", password: "x".repeat(73) },
    { name: "A", email: "a@example.com", password: "password123", admin: true },
  ])("rejects invalid registration %j", async (input) => {
    const response = await request(app)
      .post("/auth/register")
      .send(input)
      .expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
  test("returns identical failures for wrong password and unknown account", async () => {
    const wrong = await request(app)
      .post("/auth/login")
      .send({ email: owner.email, password: "wrong" })
      .expect(401);
    const unknown = await request(app)
      .post("/auth/login")
      .send({ email: "unknown@example.com", password: "wrong" })
      .expect(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });
  test("accepts mixed-case login and signs a verifiable expiring token", async () => {
    const response = await request(app)
      .post("/auth/login")
      .send({ email: "OWNER@EXAMPLE.COM", password: "password123" })
      .expect(200);
    const token = jwt.verify(
      response.body.data.access_token,
      config.jwtSecret,
      {
        algorithms: ["HS256"],
        issuer: "team-task-tracker",
        audience: "team-task-tracker-api",
      },
    );
    expect(token.sub).toBe(String(owner.id));
    expect(token.exp).toBeGreaterThan(token.iat);
    expect(JSON.stringify(response.body)).not.toMatch(/password/);
  });
  test("rejects missing, forged, expired and wrong-audience tokens", async () => {
    await request(app).get("/projects").expect(401);
    const options = {
      subject: String(owner.id),
      issuer: "team-task-tracker",
      audience: "team-task-tracker-api",
    };
    for (const token of [
      "invalid",
      jwt.sign({}, "wrong-secret", options),
      jwt.sign({}, config.jwtSecret, { ...options, expiresIn: -1 }),
      jwt.sign({}, config.jwtSecret, { ...options, audience: "elsewhere" }),
    ]) {
      await request(app)
        .get("/projects")
        .set("Authorization", "Bearer " + token)
        .expect(401);
    }
  });
});

describe("projects and memberships", () => {
  test("owner is automatically a member; lists contain only accessible projects", async () => {
    expect(project.owner_id).toBe(owner.id);
    const own = await as("get", "/projects").expect(200);
    expect(own.body.data.map((p) => p.id)).toEqual([project.id]);
    const theirs = await as("get", "/projects", outsider).expect(200);
    expect(theirs.body.data).toEqual([]);
    await as("get", "/projects/" + project.id, member).expect(200);
  });
  test("hides project resources from non-members", async () => {
    for (const suffix of ["", "/tasks", "/summary"]) {
      await as("get", "/projects/" + project.id + suffix, outsider).expect(404);
    }
    await as("post", "/projects/" + project.id + "/tasks", outsider)
      .send({ title: "Forbidden" })
      .expect(404);
    await as("post", "/projects/" + project.id + "/members", outsider)
      .send({ email: third.email })
      .expect(404);
    await as("delete", "/projects/" + project.id, outsider).expect(404);
  });
  test("only owners add members or delete projects", async () => {
    await as("post", "/projects/" + project.id + "/members", member)
      .send({ email: third.email })
      .expect(403);
    await as("delete", "/projects/" + project.id, member).expect(403);
    await as("post", "/projects/" + project.id + "/members")
      .send({ email: third.email.toUpperCase() })
      .expect(201);
  });
  test("duplicate membership is 409; unknown email is 404", async () => {
    await as("post", "/projects/" + project.id + "/members")
      .send({ email: member.email })
      .expect(409);
    await as("post", "/projects/" + project.id + "/members")
      .send({ email: "unknown@example.com" })
      .expect(404);
  });
  test.each(["abc", "0", "-1", "2147483648", "1.5"])(
    "invalid project id %s is 400",
    async (id) => {
      await as("get", "/projects/" + id).expect(400);
    },
  );
  test("unknown valid project id is 404; empty project name is rejected", async () => {
    await as("get", "/projects/999999").expect(404);
    await as("post", "/projects").send({ name: " " }).expect(400);
  });
  test("project deletion cascades memberships and tasks", async () => {
    await createTask({ assignee_id: member.id });
    await as("delete", "/projects/" + project.id).expect(204);
    expect((await db.query("SELECT * FROM tasks")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM project_members")).rows).toHaveLength(
      0,
    );
    await as("get", "/projects/" + project.id).expect(404);
  });
});

describe("tasks", () => {
  test("creates defaults, permits optional fields and enforces assignments", async () => {
    const task = await createTask({
      title: " Ship ",
      assignee_id: member.id,
      due_date: "2027-01-31",
      description: "Details",
    });
    expect(task).toMatchObject({
      title: "Ship",
      status: "TODO",
      priority: "MEDIUM",
      completed_at: null,
      created_by: member.id,
      project_id: project.id,
    });
    await as("post", "/projects/" + project.id + "/tasks")
      .send({ title: "No", assignee_id: outsider.id })
      .expect(400);
    await as("patch", "/tasks/" + task.id)
      .send({ assignee_id: outsider.id })
      .expect(400);
    const cleared = await as("patch", "/tasks/" + task.id)
      .send({ assignee_id: null, due_date: null, description: null })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      assignee_id: null,
      due_date: null,
      description: null,
    });
  });
  test("completion transitions preserve DONE timestamps and clear on reopen", async () => {
    const task = await createTask();
    const done = await as("patch", "/tasks/" + task.id)
      .send({ status: "DONE" })
      .expect(200);
    expect(done.body.data.completed_at).toBeTruthy();
    expect(new Date(done.body.data.updated_at).getTime()).toBeGreaterThan(
      new Date(task.updated_at).getTime(),
    );
    const repeated = await as("patch", "/tasks/" + task.id)
      .send({ status: "DONE", title: "Finished" })
      .expect(200);
    expect(repeated.body.data.completed_at).toBe(done.body.data.completed_at);
    const reopened = await as("patch", "/tasks/" + task.id)
      .send({ status: "IN_PROGRESS" })
      .expect(200);
    expect(reopened.body.data.completed_at).toBeNull();
    const again = await as("patch", "/tasks/" + task.id)
      .send({ status: "DONE" })
      .expect(200);
    expect(again.body.data.completed_at).not.toBe(done.body.data.completed_at);
    const initialDone = await createTask({ status: "DONE" });
    expect(initialDone.completed_at).toBeTruthy();
  });
  test("only project members can update, and only owner or creator can delete", async () => {
    const task = await createTask();
    await as("patch", "/tasks/" + task.id, outsider)
      .send({ title: "No" })
      .expect(404);
    await as("delete", "/tasks/" + task.id, outsider).expect(404);
    await as("post", "/projects/" + project.id + "/members")
      .send({ email: third.email })
      .expect(201);
    await as("patch", "/tasks/" + task.id, third)
      .send({ priority: "HIGH" })
      .expect(200);
    await as("delete", "/tasks/" + task.id, third).expect(403);
    await as("delete", "/tasks/" + task.id, member).expect(204);
    await as("patch", "/tasks/" + task.id)
      .send({ title: "Gone" })
      .expect(404);
    const other = await createTask();
    await as("delete", "/tasks/" + other.id).expect(204);
  });
  test("cannot assign a member from another project", async () => {
    const other = await as("post", "/projects", outsider)
      .send({ name: "Other" })
      .expect(201);
    await as("post", "/projects/" + other.body.data.id + "/members", outsider)
      .send({ email: third.email })
      .expect(201);
    await as("post", "/projects/" + project.id + "/tasks")
      .send({ title: "No", assignee_id: third.id })
      .expect(400);
  });
  test.each([
    { title: "" },
    { title: " " },
    { status: "INVALID" },
    { priority: "URGENT" },
    { due_date: "2027-02-30" },
    { due_date: "tomorrow" },
    { assignee_id: "1" },
    { completed_at: "2027-01-01" },
    { project_id: 100 },
    { created_by: 100 },
    { title: null },
    {},
  ])("rejects invalid task update %j", async (input) => {
    const task = await createTask();
    await as("patch", "/tasks/" + task.id)
      .send(input)
      .expect(400);
  });
  test("requires a title and validates unknown task identifiers", async () => {
    await as("post", "/projects/" + project.id + "/tasks")
      .send({})
      .expect(400);
    await as("patch", "/tasks/no").send({ title: "No" }).expect(400);
    await as("delete", "/tasks/99999").expect(404);
  });
});

describe("filtering, sorting, pagination and summary", () => {
  beforeEach(async () => {
    await createTask({
      title: "A",
      status: "TODO",
      priority: "LOW",
      assignee_id: owner.id,
      due_date: "2027-01-01",
    });
    await createTask({
      title: "B",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assignee_id: member.id,
      due_date: "2027-01-15",
    });
    await createTask({
      title: "C",
      status: "DONE",
      priority: "HIGH",
      assignee_id: member.id,
      due_date: "2027-02-01",
    });
    await createTask({ title: "D" });
  });
  test("combines filters and includes correct metadata, including empty pages", async () => {
    const response = await as(
      "get",
      "/projects/" +
        project.id +
        "/tasks?priority=HIGH&assignee_id=" +
        member.id +
        "&due_date_from=2027-01-01&due_date_to=2027-02-01&sort_by=due_date&sort_order=asc&page_size=1",
    ).expect(200);
    expect(response.body.data.map((t) => t.title)).toEqual(["B"]);
    expect(response.body.pagination).toEqual({
      page: 1,
      page_size: 1,
      total: 2,
      total_pages: 2,
      has_next: true,
    });
    const last = await as(
      "get",
      "/projects/" + project.id + "/tasks?page=99",
    ).expect(200);
    expect(last.body.data).toEqual([]);
    expect(last.body.pagination.total).toBe(4);
    const done = await as(
      "get",
      "/projects/" + project.id + "/tasks?status=DONE",
    ).expect(200);
    expect(done.body.data.map((t) => t.title)).toEqual(["C"]);
  });
  test("sorts dates both ways, null dates last, and defaults to ten newest tasks", async () => {
    const asc = await as(
      "get",
      "/projects/" + project.id + "/tasks?sort_by=due_date&sort_order=asc",
    ).expect(200);
    expect(asc.body.data.map((t) => t.title)).toEqual(["A", "B", "C", "D"]);
    const desc = await as(
      "get",
      "/projects/" + project.id + "/tasks?sort_by=due_date&sort_order=desc",
    ).expect(200);
    expect(desc.body.data.map((t) => t.title)).toEqual(["C", "B", "A", "D"]);
    for (let i = 0; i < 8; i++) await createTask({ title: "Extra " + i });
    const defaults = await as(
      "get",
      "/projects/" + project.id + "/tasks",
    ).expect(200);
    expect(defaults.body.data).toHaveLength(10);
    expect(defaults.body.pagination).toMatchObject({
      total: 12,
      total_pages: 2,
      page_size: 10,
    });
    const oldest = await as(
      "get",
      "/projects/" + project.id + "/tasks?sort_order=asc",
    ).expect(200);
    expect(oldest.body.data[0].title).toBe("A");
  });
  test.each([
    "page=0",
    "page=-1",
    "page=1.5",
    "page=abc",
    "page_size=51",
    "page_size=0",
    "sort_by=title",
    "sort_order=sideways",
    "status=done",
    "priority=URGENT",
    "assignee_id=0",
    "due_date_from=2027-02-30",
    "due_date_from=2027-02-01&due_date_to=2027-01-01",
    "page=1&page=2",
    "unknown=1",
    "sort_by=created_at%3BDROP%20TABLE%20tasks",
  ])("invalid query %s returns 400", async (query) => {
    await as("get", "/projects/" + project.id + "/tasks?" + query).expect(400);
  });
  test("summary reflects updates and deletions immediately", async () => {
    const initial = await as(
      "get",
      "/projects/" + project.id + "/summary",
      member,
    ).expect(200);
    expect(initial.body.data).toEqual({
      total: 4,
      by_status: { TODO: 2, IN_PROGRESS: 1, DONE: 1 },
      by_priority: { LOW: 1, MEDIUM: 1, HIGH: 2 },
    });
    const list = await as("get", "/projects/" + project.id + "/tasks").expect(
      200,
    );
    const task = list.body.data.find((t) => t.title === "A");
    await as("patch", "/tasks/" + task.id)
      .send({ status: "DONE", priority: "HIGH" })
      .expect(200);
    let summary = await as(
      "get",
      "/projects/" + project.id + "/summary",
    ).expect(200);
    expect(summary.body.data.by_status.DONE).toBe(2);
    expect(summary.body.data.by_priority.HIGH).toBe(3);
    await as("delete", "/tasks/" + task.id).expect(204);
    summary = await as("get", "/projects/" + project.id + "/summary").expect(
      200,
    );
    expect(summary.body.data.total).toBe(3);
    expect(summary.body.data.by_status.DONE).toBe(1);
  });
  test("SQL-looking text stays data", async () => {
    const title = "Robert'); DROP TABLE users; --";
    const task = await createTask({ title });
    expect(task.title).toBe(title);
    expect(
      (await db.query("SELECT count(*)::integer AS n FROM users")).rows[0].n,
    ).toBeGreaterThan(3);
  });
});

describe("database constraints and safe failures", () => {
  test("database prevents case-insensitive duplicates, invalid assignments and inconsistent completion", async () => {
    await expect(
      db.query(
        "INSERT INTO users(name, email, password_hash) VALUES ('duplicate', $1, 'hash')",
        [owner.email.toUpperCase()],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.query(
        "INSERT INTO project_members(project_id, user_id) VALUES ($1, $2)",
        [project.id, member.id],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.query(
        "INSERT INTO tasks(project_id,title,created_by,assignee_id) VALUES ($1,'bad',$2,$3)",
        [project.id, owner.id, outsider.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      db.query(
        "INSERT INTO tasks(project_id,title,created_by,status) VALUES ($1,'bad',$2,'DONE')",
        [project.id, owner.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query("INSERT INTO projects(name,owner_id) VALUES ('bad owner',$1)", [
        owner.id,
      ]),
    ).rejects.toMatchObject({ code: "23503" });
  });
  test("malformed JSON, oversized bodies, security headers and health", async () => {
    const response = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":')
      .expect(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
    expect(response.body.error.request_id).toBe(
      response.headers["x-request-id"],
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-powered-by"]).toBeUndefined();
    await request(app)
      .post("/auth/login")
      .send({ huge: "x".repeat(33000) })
      .expect(413);
    await request(app).get("/health").expect(200);
  });
  test("unexpected errors return no stack or database details", async () => {
    const failingDb = {
      query: async () => {
        throw new Error("secret postgres://admin:password@host internal stack");
      },
    };
    const broken = createApp({ db: failingDb, config, logger });
    const response = await request(broken).get("/health").expect(500);
    expect(response.body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(response.body)).not.toMatch(
      /secret|postgres|password|stack/,
    );
    expect(logger.error).toHaveBeenCalled();
  });
  test("authentication endpoint is rate limited using the standard error envelope", async () => {
    const isolated = createApp({ db, config, logger });
    let response;
    for (let i = 0; i < 31; i++)
      response = await request(isolated).post("/auth/login").send({});
    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
    expect(response.headers["retry-after"]).toBeTruthy();
  });
});
