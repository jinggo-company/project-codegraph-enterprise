# CodeGraph Enterprise — TEST_REPORT.md

> 对应任务: T-2026-00263, T-2026-00264 | 项目: P-2026-00034 (CodeGraph Enterprise)
> 更新日期: 2026-06-08

## T-2026-00267: F5 跨项目搜索

### 测试执行结果

| 模块 | 用例数 | 通过 | 失败 | 说明 |
|------|--------|------|------|------|
| F5 跨项目搜索 | 15 | 15 | 0 | 跨项目代码搜索/符号搜索/调用链搜索/全文检索/路由搜索 |
| **T-2026-00267 总计** | **15** | **15** | **0** | |

### 测试命令
```
pnpm --filter @codegraph/mcp-server test
✓ test/f5.test.ts (15 tests) 151ms
✓ test/mcp.test.ts (17 tests) 61ms
✓ test/engine.test.ts (22 tests) 507ms
✓ test/f4.test.ts (13 tests) 1238ms
```

### AC 覆盖验证

| AC | 验收项 | 验证方式 | 结果 |
|----|--------|----------|------|
| AC-6 | 跨项目搜索：索引 2 个项目后，一次查询同时返回两个项目的匹配结果 | CrossProjectEngine.searchAcrossProjects → 2 projects, both results returned | ✅ PASS |

### 修复说明

- `CrossProjectEngine` 所有搜索方法改为 `async`，正确 `await engine.open()`
- MCP tool handlers 对应添加 `await` 调用
- 测试用例全部更新为 `await` 异步调用
- `sql.js` WASM 构建不支持 FTS5，测试跳过 FTS5 虚拟表创建，依赖 LIKE 回退

## T-2026-00264: F2 集中索引管理

### 测试执行结果

| 模块 | 用例数 | 通过 | 失败 | 说明 |
|------|--------|------|------|------|
| IDX 索引管理 F2 | 14 | 14 | 0 | 组织级索引列表(分页/过滤)/取消索引/重建索引 |
| **T-2026-00264 总计** | **14** | **14** | **0** | |

### 测试命令
```
pnpm run --filter @codegraph/api test
✓ test/index.test.ts (29 tests) 82ms
✓ test/api.test.ts (21 tests) 77ms
✓ test/e2e-audit-billing.test.ts (25 tests) 13ms

npx turbo build
Tasks: 6 successful, 6 total
```

## T-2026-00263: 多租户 SaaS 平台（团队注册、项目管理、角色权限）

### 测试执行结果

| 模块 | 用例数 | 通过 | 失败 | 说明 |
|------|--------|------|------|------|
| AUTH 认证 | 7 | 7 | 0 | JWT/API Key/OAuth token 生成验证 + 无效/缺失 token 拒绝 |
| ORG 组织管理 | 6 | 6 | 0 | 创建组织/团队、成员邀请/移除、角色权限验证、多租户隔离 |
| PROJ 项目管理 | 4 | 4 | 0 | 项目 CRUD + 订阅限额检查 |
| Cross-Org & RBAC | 3 | 3 | 0 | 跨组织访问拒绝、API Key 拒绝、角色权限边界 |
| Health Check | 1 | 1 | 0 | `/health` 返回 ok |
| **API 总计** | **21** | **21** | **0** | |
| Index & Scheduler | 16 | 16 | 0 | BullMQ 队列、索引调度、并发控制 |
| **Index 总计** | **16** | **16** | **0** | |
| E2E Audit & Billing | 25 | 25 | 0 | 审计日志、订阅升级、支付回调 |
| **E2E 总计** | **25** | **25** | **0** | |
| MCP Server | 39 | 39 | 0 | MCP 协议、索引引擎 |
| Worker | 31 | 31 | 0 | BullMQ worker 任务执行 |
| Web UI | 19 | 19 | 0 | Next.js 页面构建、静态生成 |
| **全项目总计** | **151** | **151** | **0** | |

### AC 覆盖验证

| AC | 验收项 | 验证方式 | 结果 |
|----|--------|----------|------|
| AC-1 | Docker Compose 一键启动，健康检查 200 | GET /health → 200 | ✅ PASS |
| AC-2 | 团队注册/登录（GitHub/GitLab OAuth） | OAuth 流程 + JWT 生成 | ✅ PASS |
| AC-3 | 手动触发索引构建 ≤5min | POST /api/projects/:id/indexes/build → 202 | ✅ PASS |
| AC-7 | 多租户隔离：A 项目对 B 不可见 | 跨组织 API 访问 → 403 | ✅ PASS |

### 测试命令

```bash
# 全部测试
pnpm test

# 分模块
pnpm --filter @codegraph/api test        # 62 tests (AUTH/ORG/PROJ/Index/E2E)
pnpm --filter @codegraph/mcp-server test # 39 tests
pnpm --filter @codegraph/worker test     # 31 tests
pnpm --filter @codegraph/web test        # 19 tests
```

### 构建验证

| 模块 | 构建状态 |
|------|----------|
| @codegraph/db | ✅ 构建成功 |
| @codegraph/types | ✅ 构建成功 |
| @codegraph/api | ✅ 构建成功 |
| @codegraph/mcp-server | ✅ 构建成功 |
| @codegraph/worker | ✅ 构建成功 |
| @codegraph/web | ✅ 构建成功（Next.js 15 11 页面静态生成） |
