# TEST_CASES.md — CodeGraph Enterprise

## T-2026-00133: 索引调度 API + BullMQ 队列（IDX 核心）

### Prerequisites
- PostgreSQL running (test DB)
- Redis running (localhost:6379)
- `pnpm install` completed
- `pnpm --filter @codegraph/db db:migrate` completed

### Test Cases

| Case-ID | AC Ref | Description | Command | Expected |
|---------|--------|-------------|---------|----------|
| IDX-001 | AC-1 | POST /api/projects/:id/indexes/build creates IndexJob + enqueues BullMQ | `pnpm --filter @codegraph/api test -- -t 'IDX-001'` | PASS |
| IDX-002 | AC-2 | POST /api/projects/:id/indexes/sync creates incremental sync task | `pnpm --filter @codegraph/api test -- -t 'IDX-002'` | PASS |
| IDX-003 | AC-3 | GET /api/projects/:id/indexes returns index list | `pnpm --filter @codegraph/api test -- -t 'IDX-003'` | PASS |
| IDX-004 | AC-4 | GET /api/indexes/:indexId/status returns status | `pnpm --filter @codegraph/api test -- -t 'IDX-004'` | PASS |
| IDX-005 | AC-5 | GET /api/indexes/:indexId/stats returns statistics | `pnpm --filter @codegraph/api test -- -t 'IDX-005'` | PASS |
| IDX-006 | AC-6 | IndexJob Prisma model is complete | `pnpm prisma validate` | PASS |

### Test Details

#### IDX-001: POST Build Index
1. Create test project with valid team membership
2. POST `/api/projects/:projectId/indexes/build`
3. Assert 202 status
4. Assert Index record created with `status: QUEUED` and `type: FULL`
5. Assert BullMQ `build-index` queue has 1 waiting job

#### IDX-002: POST Incremental Sync
1. Create test project + completed index
2. POST `/api/projects/:projectId/indexes/sync`
3. Assert 202 status
4. Assert Index record with `type: INCREMENTAL`
5. Assert `sync-index` queue has 1 waiting job
6. Test error: no completed index → 400

#### IDX-003: GET Index List
1. Create test project + 2 indexes
2. GET `/api/projects/:projectId/indexes`
3. Assert 200 with data array of length 2
4. Assert ordered by createdAt desc

#### IDX-004: GET Index Status
1. Create test index
2. GET `/api/indexes/:indexId/status`
3. Assert 200 with index data including stats + snapshots
4. Test 404 for non-existent ID

#### IDX-005: GET Index Stats
1. Create test index + stats
2. GET `/api/indexes/:indexId/stats`
3. Assert 200 with stats data
4. Test 404 for index without stats

#### IDX-006: Prisma Model Validation
1. Run `pnpm --filter @codegraph/db exec prisma validate`
2. Assert Index model has: id, projectId, type, status, triggerSource, stats (JSON via relation), error, timestamps
3. Assert IndexStats model has all required fields
4. Assert enums: IndexType, IndexStatus, TriggerSource
