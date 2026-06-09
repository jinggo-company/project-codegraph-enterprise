# QA Response — T-2026-00278: F7 计费/订阅模块 QA 问题修复

## 修复人
全丞（quanchen） | 2026-06-09

## 针对 QA_REPORT_T-2026-00278.md 中问题的修复

### D-04: API 服务器启动失败 — ERR_MODULE_NOT_FOUND

- **状态**: ✅ 已修复（commit `c5e3b9b`）
- **根因**: `packages/engine/package.json` 的 `"main"` 字段指向 `./src/index.ts`，运行时 Node.js ESM loader 从 `src/` 解析 `.js` 文件失败
- **修复**: `"main"` 改为 `./dist/index.js`，指向编译后的输出
- **验证**:
  - API 服务器启动成功: `pnpm --filter @codegraph/api start` → `Server listening on http://0.0.0.0:4000`
  - `/health` → `{"status":"ok"}` (200 OK)
  - F7 路由验证:
    - `GET /api/organizations/:orgId/subscription` → 401 (路由存在，需要认证)
    - `GET /api/organizations/:orgId/usage` → 401 (路由存在，需要认证)
    - `POST /api/billing/subscribe` → 401 (路由存在，需要认证)
    - `POST /api/billing/cancel-subscription` → 401 (路由存在，需要认证)

## 测试结果
- `pnpm --filter @codegraph/api test`: **111/111 PASS**
- API 服务器启动: **PASS**
- 所有 F7 路由已注册: **PASS**

## 结论
QA 报告的阻塞性问题（API 启动失败）已修复，F7 计费/订阅模块功能可以正常端到端验证。
