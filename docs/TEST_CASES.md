# CodeGraph Enterprise — TEST_CASES.md

> 对应任务: T-2026-00130 | 项目: P-2026-00020 (CodeGraph Enterprise)
> 基于 PRD: R-2026-00084
> 创建日期: 2026-06-01

## 测试策略

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Vitest | 纯函数、模块逻辑、数据转换 |
| 集成测试 | Vitest + Testcontainers | API 端点、数据库交互、MCP 协议 |
| E2E 测试 | Playwright | 用户工作流（登录→创建项目→构建索引→查询） |
| 性能测试 | k6 | 索引构建吞吐量、MCP 查询延迟 |
| MCP 协议测试 | 自定义 MCP test client | MCP 2024-11-05 协议合规性 |

---

## 1. 认证模块 (AUTH)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| AUTH-001 | GitHub OAuth 登录 | 有效 GitHub 账号 | 1. 点击 GitHub 登录 2. 授权回调 | 返回 JWT + refresh token，创建用户记录 |
| AUTH-002 | GitLab OAuth 登录 | 有效 GitLab 账号 | 1. 点击 GitLab 登录 2. 授权回调 | 返回 JWT + refresh token |
| AUTH-003 | 企业 SSO/OIDC 登录 | 已配置 IdP | 1. 访问 SSO 端点 2. 完成认证 | 返回 JWT，绑定组织 |
| AUTH-004 | API Key 认证 | 已创建 API Key | 1. MCP 请求携带 API Key header | 认证成功，路由到对应项目 |
| AUTH-005 | API Key 轮转 | 已有 API Key | 1. 调用轮转接口 | 旧 key 失效，新 key 可用 |
| AUTH-006 | 无效 token 访问 | 过期/伪造 token | 1. 访问受保护 API | 返回 401 |
| AUTH-007 | 越权访问 | 用户 A 尝试访问用户 B 的项目 | 1. 携带 A 的 token 访问 B 的资源 | 返回 403 |

## 2. 组织与团队管理 (ORG)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| ORG-001 | 创建组织 | 已登录用户 | POST /api/organizations | 创建成功，用户为 owner |
| ORG-002 | 创建团队 | 已有组织 | POST /api/organizations/:id/teams | 团队创建成功 |
| ORG-003 | 邀请团队成员 | 已有团队 | POST /api/teams/:id/members (指定角色) | 成员创建，角色正确 |
| ORG-004 | 移除成员 | 团队有成员 | DELETE /api/teams/:id/members/:uid | 成员移除 |
| ORG-005 | 角色权限验证 | viewer 角色 | 尝试删除项目 | 返回 403 |
| ORG-006 | 多租户数据隔离 | 两个组织各有项目 | 组织 A 查询组织 B 的索引 | 无数据返回 |

## 3. 项目管理 (PROJ)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| PROJ-001 | 创建项目 | 已有团队 | POST /api/teams/:id/projects (绑定 Git URL) | 项目创建，状态 pending_index |
| PROJ-002 | 更新项目配置 | 已有项目 | PATCH /api/projects/:id | 配置更新成功 |
| PROJ-003 | 删除项目 | 已有项目 | DELETE /api/projects/:id | 项目标记删除，索引文件清理 |
| PROJ-004 | 列出项目索引 | 已有项目 | GET /api/projects/:id/indexes | 返回索引列表 |

## 4. 索引构建 (IDX)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| IDX-001 | 手动触发全量索引 | 已有项目 | POST /api/projects/:id/indexes/build | 任务入队，status=queued |
| IDX-002 | 全量索引构建完成 | 索引任务 running | 等待 Worker 完成 | status=completed, stats 可用 |
| IDX-003 | 增量同步 | 已有有效索引 | POST /api/projects/:id/indexes/sync | 增量索引构建，仅变更文件 |
| IDX-004 | CI/CD Webhook 触发 | 已配置 webhook | 推送代码到 GitHub | 自动创建索引任务 |
| IDX-005 | 索引构建失败 | 项目仓库不可达 | 触发全量索引 | status=failed, error 字段有值 |
| IDX-006 | 索引并发控制 | 同一项目已有 running 任务 | 再次触发构建 | 新任务被拒绝或排队 |
| IDX-007 | 索引清理 | 有过期索引 | POST /api/indexes/:id/cleanup | 旧索引删除 |
| IDX-008 | 多语言支持验证 | 含 TS/Python/Go 的项目 | 构建索引 | 各语言符号均被正确索引 |
| IDX-009 | Web 框架路由识别 | 含 Express/Spring 路由的项目 | 构建索引 | 路由→处理器映射正确 |
| IDX-010 | 增量同步延迟 | 文件变更后 | 等待自动同步 | ≤2s 内同步完成（本地 CodeGraph 能力） |

## 5. MCP Server 网关 (MCP)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| MCP-001 | MCP 初始化握手 | MCP Server 运行 | 发送 initialize 请求 | 返回 server info + capabilities |
| MCP-002 | search_code 工具 | 已有索引 | 调用 search_code(query="user", project=X) | 返回匹配文件/符号列表 |
| MCP-003 | get_symbol 工具 | 已有索引 | 调用 get_symbol(name="getUser", kind="function") | 返回符号详情（位置、签名） |
| MCP-004 | get_callers 工具 | 已有索引 | 调用 get_callers(name="getUser") | 返回调用者列表 |
| MCP-005 | get_callees 工具 | 已有索引 | 调用 get_callees(name="processOrder") | 返回被调用者列表 |
| MCP-006 | get_impact 工具 | 已有索引 | 调用 get_impact(file="src/auth.ts") | 返回完整影响半径 |
| MCP-007 | search_routes 工具 | 含 Express 路由的索引 | 调用 search_routes(pattern="/api/users") | 返回路由→处理器映射 |
| MCP-008 | search_fulltext 工具 | 已有索引 | 调用 search_fulltext(query="authentication") | 返回 FTS5 搜索结果 |
| MCP-009 | MCP 协议版本兼容 | 不同 MCP client | Claude Code / Cursor 分别连接 | 协议协商正确 |
| MCP-010 | 多项目查询路由 | 多个项目索引可用 | MCP 请求指定不同 project_id | 返回对应项目数据 |
| MCP-011 | 未索引项目查询 | 项目无有效索引 | 调用任意 MCP tool | 返回 error: 索引不可用 |
| MCP-012 | 认证失败拒绝 | 无效 API Key | MCP 请求携带无效 key | 返回 error: unauthorized |

## 6. Worker 与任务队列 (WRK)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| WRK-001 | 任务入队 | API 服务运行 | 触发索引构建 | BullMQ 队列中有任务 |
| WRK-002 | Worker 消费任务 | Worker 运行 | 队列有任务 | Worker 拉取并执行 |
| WRK-003 | 任务失败重试 | 索引构建失败（网络错误） | 自动重试 | 最多重试 3 次后标记 failed |
| WRK-004 | 任务超时 | 大型代码库索引超时 | 超时后 | 任务标记 failed，清理临时文件 |
| WRK-005 | 并发限流 | 多任务同时入队 | Worker 并发执行 | 不超过配置的并发数 |
| WRK-006 | 索引快照存储 | 索引构建完成 | 检查存储 | 快照已上传 MinIO/S3 |

## 7. 审计日志 (AUDIT)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| AUDIT-001 | 创建操作记录 | 已登录用户 | 创建项目 | 审计日志记录（谁、什么操作、时间、IP） |
| AUDIT-002 | 删除操作记录 | 已有项目 | 删除项目 | 审计日志记录 |
| AUDIT-003 | 成员变更记录 | 已有团队 | 添加/移除成员 | 审计日志记录 |
| AUDIT-004 | 审计日志查询 | 已有审计记录 | GET /api/organizations/:id/audit-logs | 返回按时间排序的日志 |
| AUDIT-005 | 审计日志不可篡改 | 已有日志记录 | 尝试修改日志 | 返回 403/405，日志只读 |

## 8. 计费与订阅 (BILL)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| BILL-001 | 订阅套餐升级 | 已有 free 订阅 | POST /api/billing/subscribe (升级到 pro) | 订阅更新，权限升级 |
| BILL-002 | 支付回调处理 | 支付宝/Stripe 支付成功 | webhook 回调 | 订阅状态更新，invoice 创建 |
| BILL-003 | 订阅过期 | 订阅到期未续费 | 到期后 | 降级为 free，功能受限 |
| BILL-004 | 账单查询 | 已有订阅记录 | GET /api/organizations/:id/invoices | 返回账单列表 |
| BILL-005 | 使用量限制 | free 套餐（限制 3 个项目） | 尝试创建第 4 个项目 | 返回 402，提示升级 |

## 9. 前端仪表板 (UI)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| UI-001 | 登录页面 | 未登录 | 访问首页 | 重定向到登录页 |
| UI-002 | Dashboard 加载 | 已登录 | 访问 dashboard | 显示项目列表 + 索引状态 |
| UI-003 | 创建项目工作流 | 已登录 | 点击创建→填写信息→提交 | 项目创建成功，页面刷新 |
| UI-004 | 索引状态实时更新 | 索引构建中 | 停留在项目页 | 状态自动从 running→completed（WebSocket/轮询） |
| UI-005 | 团队管理页面 | 已登录 | 管理团队成员 | 成员列表正确显示 |
| UI-006 | 审计日志页面 | 已有审计记录 | 访问审计页 | 显示操作历史 |
| UI-007 | 响应式布局 | 任意页面 | 在不同视口查看 | 移动端/桌面端均正常显示 |

## 10. 端到端工作流 (E2E)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| E2E-001 | 新用户完整工作流 | 无账号 | GitHub 登录→创建组织→创建团队→绑定仓库→触发索引→等待完成→通过 MCP 查询 | 全流程成功 |
| E2E-002 | CI/CD 自动索引 | 已有项目 + webhook | 推送代码→webhook 触发→索引自动更新→MCP 查询到新内容 | 全流程成功 |
| E2E-003 | Claude Code 集成 | 已有索引 | Claude Code 配置 MCP → 搜索代码 → 查看调用关系 → 影响分析 | 查询结果正确返回 |
| E2E-004 | Cursor 集成 | 已有索引 | Cursor 配置 MCP → 搜索路由 → 查看符号详情 | 查询结果正确返回 |
| E2E-005 | 多租户隔离 | 两个组织各有索引 | 组织 A 用户查询组织 B 项目 | 无法访问，返回错误 |
| E2E-006 | 订阅升级流程 | free 用户 | 升级 pro→支付→功能解锁 | 权限正确升级 |

## 11. 性能测试 (PERF)

| Case-ID | 描述 | 前置条件 | 指标 |
|---------|------|----------|------|
| PERF-001 | 索引构建性能 | 10K 文件 TS 项目 | ≤15min 完成全量索引 |
| PERF-002 | MCP 查询延迟 | 已有索引 | P50 ≤ 50ms, P99 ≤ 200ms |
| PERF-003 | API 吞吐量 | API 服务运行 | ≥500 req/s (简单查询) |
| PERF-004 | 并发索引构建 | 10 个项目同时构建 | 全部成功，无资源竞争 |

## 12. 安全测试 (SEC)

| Case-ID | 描述 | 前置条件 | 预期结果 |
|---------|------|----------|----------|
| SEC-001 | XSS 防护 | 注入恶意 script | 被 CSP/escape 拦截 |
| SEC-002 | SQL 注入 | 构造恶意查询参数 | Prisma ORM 自动防护 |
| SEC-003 | CSRF 防护 | 跨站请求 | Token 验证拒绝 |
| SEC-004 | Webhook HMAC 验证 | 伪造 webhook 请求 | HMAC 校验失败，拒绝处理 |
| SEC-005 | 索引文件访问控制 | 直接访问索引文件路径 | 返回 403/404 |

---

## 测试用例统计

| 模块 | 用例数 | 优先级 |
|------|--------|--------|
| AUTH 认证 | 7 | P0 |
| ORG 组织管理 | 6 | P0 |
| PROJ 项目管理 | 4 | P0 |
| IDX 索引构建 | 10 | P0 |
| MCP MCP 网关 | 12 | P0 |
| WRK Worker | 6 | P1 |
| AUDIT 审计 | 5 | P1 |
| BILL 计费 | 5 | P1 |
| UI 前端 | 7 | P2 |
| E2E 端到端 | 6 | P0 |
| PERF 性能 | 4 | P1 |
| SEC 安全 | 5 | P1 |
| **总计** | **77** | |
