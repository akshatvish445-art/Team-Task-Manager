# Team Task Tracker API

A production-minded REST API for registering users, collaborating in projects, assigning tasks, tracking progress, and calculating project summaries. The service uses Node.js, CommonJS, Express, PostgreSQL, bcrypt-compatible password hashing, JWT access tokens, Zod validation, and Jest/Supertest integration tests.

The complete endpoint reference and request examples are in [docs/API.md](docs/API.md).

## Quick start

Prerequisites: Node.js 20 or newer, npm, and PostgreSQL 14 or newer. Docker Compose can provide PostgreSQL if it is not installed locally.

```bash
npm install
docker compose up -d db
cp .env.example .env
npm run migrate
npm start
```

PowerShell equivalents for the copy command and a generated JWT secret are:

```powershell
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Put the generated value in `JWT_SECRET` in `.env`. The example Compose database matches the default `DATABASE_URL`. The API listens at `http://localhost:3000`; `GET /health` checks both HTTP and database availability.

Migrations are applied explicitly with `npm run migrate`, rather than implicitly on server startup. The runner serializes concurrent migration attempts with a PostgreSQL advisory transaction lock, records SHA-256 checksums, and refuses to continue if an already-applied migration was edited.

## Tests

Tests intentionally run against PostgreSQL so they exercise PostgreSQL constraints, cascades, filtered aggregates, timestamp behavior, and parameter binding. Create a separate database whose name ends in `_test`:

```bash
docker compose exec db createdb -U tracker team_tracker_test
```

Then run:

```bash
TEST_DATABASE_URL=postgresql://tracker:tracker_dev_password@localhost:5432/team_tracker_test npm test
```

PowerShell:

```powershell
$env:TEST_DATABASE_URL='postgresql://tracker:tracker_dev_password@localhost:5432/team_tracker_test'
npm test
```

The `_test` suffix is enforced before any fixtures are cleaned, preventing accidental truncation of a development or production database. Tests cover registration and login, JWT rejection cases, project isolation, owner-only operations, task authorization, assignment constraints, completion transitions, filters, deterministic sorting, pagination, summaries, malformed JSON, security headers, SQL-looking input, and safe internal errors.

## Code structure

```text
src/config/        environment validation and PostgreSQL pool
src/controllers/   HTTP response handling
src/middleware/    JWT authentication and error handling
src/repositories/  SQL execution and safe dynamic task listing
src/routes/        routes and middleware composition
src/services/      transactions, authorization, and business rules
src/validators/    request schemas
migrations/        reproducible PostgreSQL schema
scripts/           migration runner
tests/             Jest/Supertest integration tests
docs/              API reference
```

Controllers stay small. Services own workflows and authorization. The repository owns the one dynamic query; every client value remains a PostgreSQL parameter, while sort columns and directions are selected from explicit allowlists.

## Authentication and authorization

Authentication establishes who made a request. `authenticate` verifies the Bearer JWT signature, algorithm, issuer, audience, expiry, subject, and that the subject still identifies a user.

Authorization decides what that authenticated user may do. Services verify project membership for every project or task access, verify ownership before member additions and project deletion, and verify project ownership or task creation before task deletion. These checks run on the server and do not depend on a client interface.

Resources are hidden across project boundaries: a valid project or task that the caller cannot access returns `404`, the same as an unknown resource. A known member attempting an operation reserved for the project owner or task creator receives `403`.

## Schema decisions

- `users`: the functional unique index on `lower(email)` enforces case-insensitive uniqueness even if an application path forgets to normalize email. Passwords are stored only in `password_hash`.
- `projects`: `owner_id` records ownership explicitly and uses `ON DELETE RESTRICT`; a user who still owns a project cannot be silently removed.
- `project_members`: the composite primary key `(project_id, user_id)` prevents duplicate membership. Its project foreign key uses `ON DELETE CASCADE`, so deleting a project removes memberships.
- Owner membership is enforced with a deferred composite foreign key from `(projects.id, projects.owner_id)` to `project_members`. Deferral lets project and membership rows be inserted atomically in one transaction.
- `tasks`: the project uses `ON DELETE CASCADE`, so a deleted project removes its tasks. Creator and assignee relationships are composite foreign keys through `project_members`, making it impossible for either to reference somebody outside the task's project. User deletion is restricted while referenced.
- Check constraints enforce status and priority values, nonblank names and titles, description length, and the invariant that only `DONE` tasks have `completed_at`.
- Membership lookup, project ownership, task creator, and common project-plus-filter/sort paths have indexes. The leading `project_id` matches the authorization boundary and dominant task-list predicate.

Project creation is transactional because the deferred ownership constraint requires both the project and owner-membership rows to commit together. Member addition and every task mutation are also transactional. Task updates lock their row so concurrent status transitions cannot race.

## Completion timestamps

Entering `DONE` sets `completed_at` using the database clock. Changing a `DONE` task while it remains `DONE` preserves the original timestamp. Reopening it clears the timestamp; completing it again creates a new one. Every successful `PATCH` advances `updated_at`, with a one-microsecond fallback when two updates occur inside the same clock tick.

## Security and operational behavior

- bcrypt-compatible hashing uses a configurable cost of 10–15; production defaults to 12.
- Login uses the same generic error for unknown accounts and wrong passwords, and performs a bcrypt comparison in both cases.
- JWT verification is pinned to HS256 and configured issuer/audience values.
- Authentication endpoints are rate limited to 30 requests per 15 minutes per client.
- Helmet sets HTTP security headers; responses disable caching and include an `X-Request-Id` correlation ID.
- JSON bodies are limited to 32 KB. Malformed JSON and oversized bodies use the normal JSON error envelope.
- Environment configuration is validated on startup. TLS can be enabled with `DATABASE_SSL=true` for servers with trusted certificates.
- Production clients receive no stack traces, database messages, SQL, credentials, or password hashes.
- The server has request/header timeouts and shuts down gracefully on `SIGINT` or `SIGTERM`.

Keep `.env` out of source control. Use a secret manager in deployed environments and a long random `JWT_SECRET`. Run migrations as a deployment step before starting new application instances.
