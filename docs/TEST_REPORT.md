# TEST_REPORT.md — CodeGraph Enterprise

## T-2026-00134: MCP Server 网关实现

### Test Execution

- **Date:** 2026-06-01
- **Command:** `pnpm --filter @codegraph/mcp-server test`
- **Result:** 39/39 PASS
  - 17 mcp.test.ts tests (auth, config, engine, tools, protocol)
  - 22 engine.test.ts tests (all 7 tools with real SQLite index)

### Case Results

| Case-ID | Description | Result | Notes |
|---------|-------------|--------|-------|
| MCP-001 | Auth middleware: isAuthRequired, extractApiKey, validateApiKey, hashApiKey | PASS | SHA-256 hash comparison works |
| MCP-002 | Configuration: loadConfig, env vars, getIndexFilePath | PASS | Defaults + custom env verified |
| MCP-003 | engine hasIndex returns false for non-existent path | PASS | SQLite header magic check |
| MCP-004 | engine open() without index throws | PASS | Async rejection verified |
| MCP-005 | search_code returns matching symbols by name | PASS | SQLite LIKE query + language filter + limit |
| MCP-005b | search_code filters by language | PASS | TS vs Python isolation |
| MCP-005c | search_code respects limit | PASS | Limit enforced |
| MCP-006 | get_symbol returns symbol details | PASS | name, kind, file, line, signature, documentation |
| MCP-006b | get_symbol filters by kind | PASS | Class vs function disambiguation |
| MCP-006c | get_symbol returns empty for unknown | PASS | Graceful empty |
| MCP-007 | get_callers returns caller list | PASS | call_edges WHERE callee = ? |
| MCP-007b | get_callers returns empty for unknown | PASS | Graceful empty |
| MCP-008 | get_callees returns callee list | PASS | call_edges WHERE caller = ? |
| MCP-008b | get_callees returns empty for unknown | PASS | Graceful empty |
| MCP-009 | get_impact returns BFS impact analysis | PASS | Distance 1 + 2 transitive verified |
| MCP-009b | get_impact returns empty for unknown | PASS | Graceful empty |
| MCP-010 | search_routes returns all routes | PASS | 4 routes loaded |
| MCP-010b | search_routes filters by urlPattern | PASS | LIKE pattern matching |
| MCP-010c | search_routes filters by framework | PASS | Express vs Fastify |
| MCP-011 | search_fulltext returns LIKE fallback results | PASS | FTS5 not available, LIKE works |
| MCP-011b | search_fulltext returns results for common keyword | PASS | Multiple results |
| MCP-011c | search_fulltext respects limit | PASS | Limit enforced |
| MCP-012 | Multi-project isolation: queries by project_id | PASS | Separate index.db files |
| MCP-012b | throws when opening non-existent project | PASS | Async rejection |
| MCP-012c | hasIndex returns false for non-existent | PASS | File-existence proxy |
| MCP-013 | Protocol: McpServer constructor accepts name+version | PASS | @modelcontextprotocol/sdk 1.6+ |
| MCP-014 | All 7 tools exported from tools/index | PASS | registerSearchCode..registerSearchFulltext |
| MCP-015 | Server info matches config | PASS | name + version |
| MCP-016 | Engine returns empty array for unindexed project | PASS | Graceful error via hasIndex check |

### Verification Actions

- MCP-001~012 all PASS ✅
- `pnpm --filter @codegraph/mcp-server test` ✅ 39/39

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
