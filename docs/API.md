# API reference

Base URL in local development: `http://localhost:3000`. Send JSON with `Content-Type: application/json`. Protected endpoints require:

```http
Authorization: Bearer <access_token>
```

Successful object responses use `{ "data": ... }`. Task lists use `data` plus `pagination`. A `204` response has no body.

## Error format

Every API error has one shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data.",
    "request_id": "e978c6fc-27a7-4be8-b882-299670485817",
    "details": [
      { "field": "email", "message": "Invalid email address" }
    ]
  }
}
```

`details` is included for validation failures. Status codes are predictable:

| Status | Meaning |
| --- | --- |
| `400` | Invalid body, ID, assignee, filter, sort, or pagination value |
| `401` | Missing/invalid token or invalid login credentials |
| `403` | Authenticated project member lacks permission for the operation |
| `404` | Unknown route/resource, inaccessible resource, or unknown member email |
| `409` | Email already registered or user already a project member |
| `413` | JSON body exceeds 32 KB |
| `429` | Authentication rate limit exceeded |
| `500` | Unexpected internal failure; implementation details are hidden |

Unknown positive integer IDs return `404`. Malformed, zero, negative, fractional, or out-of-range IDs return `400`. Cross-project resources are returned as `404` to avoid disclosing their existence.

## Authentication

### `POST /auth/register`

Name, email, and password are required. Email is normalized to lowercase and unique case-insensitively. Passwords must be at least eight characters and at most 72 UTF-8 bytes, matching bcrypt's input limit.

```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"correct-horse"}'
```

Returns `201` with `id`, `name`, `email`, and `created_at`. Password material is never returned. Duplicate email returns `409 EMAIL_EXISTS`.

### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"correct-horse"}'
```

Returns `200`:

```json
{
  "data": {
    "access_token": "eyJ...",
    "token_type": "Bearer",
    "user": { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "created_at": "2026-10-30T08:00:00.000Z" }
  }
}
```

Unknown email and wrong password both return `401 INVALID_CREDENTIALS` with the same message.

## Projects

### `POST /projects`

Creates a project. The caller becomes owner and member atomically.

```bash
curl -X POST http://localhost:3000/projects \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"API launch"}'
```

Returns `201` with `id`, `name`, `owner_id`, and `created_at`.

### `GET /projects`

Returns `200` with every project in which the caller is a member, newest first:

```json
{ "data": [{ "id": 3, "name": "API launch", "owner_id": 1, "created_at": "2026-10-30T08:00:00.000Z" }] }
```

### `GET /projects/:projectId`

Returns project details to members. Non-members and unknown projects receive `404`.

### `POST /projects/:projectId/members`

Owner only. The email must identify an existing account; matching is case-insensitive.

```bash
curl -X POST http://localhost:3000/projects/3/members \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"grace@example.com"}'
```

Returns `201` with the project ID, public user fields, and `joined_at`. An unknown email returns `404 USER_NOT_FOUND`; an existing membership, including the owner, returns `409 ALREADY_MEMBER`.

### `DELETE /projects/:projectId`

Owner only. Returns `204`. PostgreSQL cascades the deletion to project memberships and tasks.

## Tasks

Task fields are:

| Field | Accepted value |
| --- | --- |
| `title` | Required nonblank string, maximum 200 characters |
| `description` | Optional string up to 10,000 characters, or `null` |
| `status` | `TODO`, `IN_PROGRESS`, or `DONE`; default `TODO` |
| `priority` | `LOW`, `MEDIUM`, or `HIGH`; default `MEDIUM` |
| `assignee_id` | Optional positive user ID or `null`; must be a project member |
| `due_date` | Optional ISO calendar date (`YYYY-MM-DD`) or `null` |

Server-managed fields are `id`, `project_id`, `created_by`, `completed_at`, `created_at`, and `updated_at`; attempts to write them are rejected.

### `POST /projects/:projectId/tasks`

Any project member may create a task.

```bash
curl -X POST http://localhost:3000/projects/3/tasks \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Add audit logs","description":"Record mutations","status":"TODO","priority":"HIGH","assignee_id":2,"due_date":"2026-12-15"}'
```

Returns `201` with the complete task. `DONE` at creation sets `completed_at`. A non-member assignee returns `400 INVALID_ASSIGNEE`.

### `GET /projects/:projectId/tasks`

Any project member may list tasks. Filters combine with logical AND.

| Parameter | Values and behavior |
| --- | --- |
| `status` | `TODO`, `IN_PROGRESS`, or `DONE` |
| `priority` | `LOW`, `MEDIUM`, or `HIGH` |
| `assignee_id` | Positive integer project-member ID |
| `due_date_from` | Inclusive ISO date lower bound |
| `due_date_to` | Inclusive ISO date upper bound; cannot precede `due_date_from` |
| `sort_by` | `created_at` (default) or `due_date` |
| `sort_order` | `desc` (default) or `asc` |
| `page` | Positive integer, default `1` |
| `page_size` | Integer `1`–`50`, default `10` |

Unsupported parameters, duplicate parameters, invalid values, and unsupported sort fields/directions return `400 VALIDATION_ERROR`. Null due dates always sort last. Ties use task ID in the same direction, making pagination deterministic.

```bash
curl "http://localhost:3000/projects/3/tasks?status=TODO&priority=HIGH&assignee_id=2&due_date_from=2026-11-01&due_date_to=2026-12-31&sort_by=due_date&sort_order=asc&page=1&page_size=20" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [{ "id": 8, "project_id": 3, "title": "Add audit logs", "status": "TODO", "priority": "HIGH" }],
  "pagination": { "page": 1, "page_size": 20, "total": 1, "total_pages": 1, "has_next": false }
}
```

A page beyond the end returns an empty `data` array and retains accurate total metadata.

### `PATCH /tasks/:taskId`

Any member of the task's project may update one or more writable task fields. Empty objects and unknown fields are rejected.

```bash
curl -X PATCH http://localhost:3000/tasks/8 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"DONE","priority":"MEDIUM"}'
```

Entering `DONE` sets `completed_at`. A subsequent update that leaves the task `DONE` preserves that timestamp. Reopening clears it, and later completion records a new timestamp. Every successful patch advances `updated_at`.

### `DELETE /tasks/:taskId`

The project owner or the user recorded in `created_by` may delete the task. Returns `204`. A different project member receives `403`; a non-member receives `404`.

## Project summary

### `GET /projects/:projectId/summary`

Available to project members. Counts are calculated from current task rows on every request.

```json
{
  "data": {
    "total": 7,
    "by_status": { "TODO": 3, "IN_PROGRESS": 2, "DONE": 2 },
    "by_priority": { "LOW": 1, "MEDIUM": 4, "HIGH": 2 }
  }
}
```

## Health check

`GET /health` does not require a token. It runs a database probe and returns `200` with `{ "data": { "status": "ok" } }`. Database failures use the standard `500 INTERNAL_ERROR` response without exposing connection details.
