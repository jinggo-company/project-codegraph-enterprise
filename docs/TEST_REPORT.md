# TEST_REPORT.md — CodeGraph Enterprise

## T-2026-00133: 索引调度 API + BullMQ 队列（IDX 核心）

### Test Execution

- **Date:** 2026-06-01
- **Command:** `pnpm --filter @codegraph/api test`
- **Result:** 33/33 PASS
  - 21 existing tests (AUTH, ORG, PROJ) — all PASS
  - 12 new IDX tests — all PASS

### Case Results

| Case-ID | Description | Result | Notes |
|---------|-------------|--------|-------|
| IDX-001 | POST /api/projects/:id/indexes/build creates IndexJob + enqueues BullMQ | PASS | 202, QUEUED, audit log |
| IDX-002 | POST /api/projects/:id/indexes/sync creates incremental sync task | PASS | 202, INCREMENTAL |
| IDX-002b | POST sync returns 400 if no completed index exists | PASS | BAD_REQUEST |
| IDX-003 | GET /api/projects/:id/indexes returns index list | PASS | Array ordered by createdAt desc |
| IDX-004 | GET /api/indexes/:indexId/status returns status | PASS | Includes stats + snapshots |
| IDX-004b | GET status returns 404 for non-existent index | PASS | NOT_FOUND |
| IDX-005 | GET /api/indexes/:indexId/stats returns statistics | PASS | filesScanned, symbolsIndexed, callGraphEdges |
| IDX-005b | GET stats returns 404 for index without stats | PASS | NOT_FOUND |
| IDX-006 | Rate-limited request returns 429 | PASS | TOO_MANY_REQUESTS |
| IDX-006b | Locked project returns 429 | PASS | TOO_MANY_REQUESTS |
| IDX-006c | Unauthenticated request returns 401 | PASS | UNAUTHORIZED |
| IDX-006d | Build index for non-existent project returns 404 | PASS | NOT_FOUND |

### IDX-006: Prisma Model Validation

- **Index** model: id, projectId, type, status, triggerSource, startedAt, completedAt, error, createdAt ✅
- **IndexStats** model: filesScanned, symbolsIndexed, callGraphEdges, sqliteSizeBytes, durationMs ✅
- **IndexJob** model: id, projectId, indexId, type, trigger, status, priority, retries, maxRetries, error, timestamps ✅
- **Enums**: IndexType (FULL/INCREMENTAL/CLEANUP), IndexStatus (QUEUED/RUNNING/COMPLETED/FAILED), TriggerSource (WEBHOOK/MANUAL/WATCHER/SCHEDULE) ✅

### Verification Actions

- IDX-001~006 all PASS ✅
- `pnpm --filter @codegraph/api test` ✅ 33/33
