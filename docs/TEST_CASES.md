# CodeGraph Enterprise — TEST_CASES.md

> 对应任务: T-2026-00262 | 项目: P-2026-00034 (CodeGraph Enterprise)
> 基于 PRD: spec-writes/P-2026-00034/docs/PRD.md
> 更新日期: 2026-06-09 | 原创建: 2026-06-01
> 更新: T-2026-00266 新增 F4 MCP Server 网关托管测试

## AC 覆盖矩阵

本文件按 PRD 的 AC-1 ~ AC-12 验收标准组织，每个 AC 至少对应一个 Case-ID。

| AC | Case-IDs | 描述 |
|----|----------|------|
| AC-1 | INFRA-001, INFRA-002 | Docker Compose 一键启动，健康检查 200 |
| AC-2 | AUTH-001, AUTH-008 | 团队注册与登录（企微/钉钉 SSO 或邮箱密码），创建项目成功 |
| AC-3 | IDX-001, IDX-002, PERF-005 | 手动触发索引构建，5 分钟内完成（≤5K 文件），状态可见 |
| AC-4 | WEBHOOK-001, WEBHOOK-002, WEBHOOK-003 | GitHub Webhook push → 2min 内自动触发索引重建，构建日志可查 |
| AC-5 | MCP-001, MCP-002, MCP-003, MCP-004, F4-001, F4-002, F4-003 | MCP 端点连接 Claude Code/Cursor，执行代码查询，返回图谱数据，HTTP/SSE 传输正常 |
| AC-6 | MCP-013 | 跨项目搜索：索引 2 个项目后，一次查询同时返回两个项目的匹配结果 |
| AC-7 | ORG-006, SEC-006 | 多租户隔离：租户 A 的项目和索引对租户 B 不可见，API 返回 403 |
| AC-8 | AUDIT-001 ~ AUDIT-009 | 审计日志：构建/查询/操作全量记录，支持时间/类型过滤，CSV/JSON 导出 |
| AC-9 | BILL-001 ~ BILL-008 | 订阅升级/降级，微信/支付宝支付，限额即时生效 |
| AC-10 | NOTIFY-001 ~ NOTIFY-005 | 企微/钉钉通知（构建、审批、用量告警），HMAC 签名推送 |
| AC-11 | PERF-002, PERF-006 | MCP Server 10 并发查询 P95 延迟 <2s |
| AC-12 | SEC-001, SEC-002, SEC-007, SEC-008 | API 鉴权、HTTPS 强制、SQL 注入防护、租户数据行级隔离 |

## 测试策略

| 层级 | 工具 | 覆盖范围 |
|------|------|----------|
| 单元测试 | Vitest | 纯函数、模块逻辑、数据转换 |
| 集成测试 | Vitest + Testcontainers | API 端点、数据库交互、MCP 协议 |
| E2E 测试 | Playwright | 用户工作流（登录→创建项目→构建索引→查询） |
| 性能测试 | k6 | 索引构建吞吐量、MCP 查询延迟 |
| MCP 协议测试 | 自定义 MCP test client | MCP 2024-11-05 协议合规性 |

---

## 0. 基础设施 (INFRA) — 覆盖 AC-1

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| INFRA-001 | Docker Compose 一键启动 | Docker + Docker Compose 已安装 | `docker compose up -d` | 所有容器启动成功，无 error |
| INFRA-002 | 健康检查返回 200 | Docker Compose 已启动 | `curl http://localhost:4000/health` | HTTP 200，返回 `{status: "ok"}` |

---

## 1. 认证模块 (AUTH) — 覆盖 AC-2

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| AUTH-001 | 邮箱密码注册登录 | 无账号 | 1. POST /api/auth/register 2. POST /api/auth/login | 返回 JWT + refresh token，创建用户记录 |
| AUTH-002 | GitHub OAuth 登录 | 有效 GitHub 账号 | 1. 点击 GitHub 登录 2. 授权回调 | 返回 JWT + refresh token |
| AUTH-003 | GitLab OAuth 登录 | 有效 GitLab 账号 | 1. 点击 GitLab 登录 2. 授权回调 | 返回 JWT + refresh token |
| AUTH-004 | API Key 认证 | 已创建 API Key | 1. MCP 请求携带 API Key header | 认证成功，路由到对应项目 |
| AUTH-005 | API Key 轮转 | 已有 API Key | 1. 调用轮转接口 | 旧 key 失效，新 key 可用 |
| AUTH-006 | 无效 token 访问 | 过期/伪造 token | 1. 访问受保护 API | 返回 401 |
| AUTH-007 | 越权访问 | 用户 A 尝试访问用户 B 的项目 | 1. 携带 A 的 token 访问 B 的资源 | 返回 403 |
| AUTH-008 | 创建项目成功 | 已登录 + 已创建组织/团队 | POST /api/teams/:id/projects | 项目创建成功，状态 pending_index |

## 2. 组织与团队管理 (ORG) — 覆盖 AC-7

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| ORG-001 | 创建组织 | 已登录用户 | POST /api/organizations | 创建成功，用户为 owner |
| ORG-002 | 创建团队 | 已有组织 | POST /api/organizations/:id/teams | 团队创建成功 |
| ORG-003 | 邀请团队成员 | 已有团队 | POST /api/teams/:id/members (指定角色) | 成员创建，角色正确 |
| ORG-004 | 移除成员 | 团队有成员 | DELETE /api/teams/:id/members/:uid | 成员移除 |
| ORG-005 | 角色权限验证 | viewer 角色 | 尝试删除项目 | 返回 403 |
| ORG-006 | 多租户数据隔离 | 两个组织各有项目 | 组织 A 查询组织 B 的索引 | 无数据返回，API 返回 403 |

## 3. 项目管理 (PROJ)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| PROJ-001 | 创建项目 | 已有团队 | POST /api/teams/:id/projects (绑定 Git URL) | 项目创建，状态 pending_index |
| PROJ-002 | 更新项目配置 | 已有项目 | PATCH /api/projects/:id | 配置更新成功 |
| PROJ-003 | 删除项目 | 已有项目 | DELETE /api/projects/:id | 项目标记删除，索引文件清理 |
| PROJ-004 | 列出项目索引 | 已有项目 | GET /api/projects/:id/indexes | 返回索引列表 |
| PROJ-005 | 索引状态可见 | 索引构建中 | GET /api/indexes/:indexId/status | 返回 running + 进度信息 |

## 4. 索引构建 (IDX) — 覆盖 AC-3

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
| IDX-010 | 索引构建日志可查 | 已有构建记录 | GET /api/indexes/:id/logs | 返回完整构建日志 |

## 5. Webhook 处理 (WEBHOOK) — 覆盖 AC-4

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| WEBHOOK-001 | GitHub Webhook 接收 | 已配置 webhook | POST /api/webhooks/github (模拟 push 事件) | 200 响应，创建索引任务 |
| WEBHOOK-002 | 2min 内自动触发索引 | Webhook 已配置 | 发送 push 事件 → 轮询索引状态 | 2min 内 status 从 queued→running |
| WEBHOOK-003 | 构建日志可查 | 构建已完成 | GET /api/indexes/:id/logs | 返回完整构建日志（含 webhook 触发记录） |
| WEBHOOK-004 | Webhook HMAC 验证 | 已配置 webhook secret | 发送无 HMAC 的请求 | 返回 401，请求被拒绝 |
| WEBHOOK-005 | 同一 push 多事件去重 | 同一 push 触发 3 个 webhook | 同时发送 3 个 push 事件 | 只创建 1 个构建任务 |

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
| MCP-013 | 跨项目搜索 | 已索引 2 个项目 | search_code(query="getUser", 不指定 project) | 同时返回两个项目的匹配结果 |

## 6. MCP Server 网关 (MCP) — 覆盖 AC-5, AC-6, AC-11

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| WRK-001 | 任务入队 | API 服务运行 | 触发索引构建 | BullMQ 队列中有任务 |
| WRK-002 | Worker 消费任务 | Worker 运行 | 队列有任务 | Worker 拉取并执行 |
| WRK-003 | 任务失败重试 | 索引构建失败（网络错误） | 自动重试 | 最多重试 3 次后标记 failed |
| WRK-004 | 任务超时 | 大型代码库索引超时 | 超时后 | 任务标记 failed，清理临时文件 |
| WRK-005 | 并发限流 | 多任务同时入队 | Worker 并发执行 | 不超过配置的并发数 |
| WRK-006 | 索引快照存储 | 索引构建完成 | 检查存储 | 快照已上传 MinIO/S3 |

## 7. Worker 与任务队列 (WRK)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| AUDIT-001 | 索引构建操作记录 | 已登录用户 | 触发索引构建 | 审计日志记录（操作人、时间、项目） |
| AUDIT-002 | 索引查询操作记录 | 已有索引 | 通过 MCP 执行查询 | 审计日志记录（查询内容、时间、项目） |
| AUDIT-003 | 成员变更记录 | 已有团队 | 添加/移除成员 | 审计日志记录 |
| AUDIT-004 | 审计日志按时间过滤 | 已有审计记录 | GET /api/organizations/:id/audit-logs?from=X&to=Y | 返回时间范围内的日志 |
| AUDIT-005 | 审计日志按操作类型过滤 | 已有审计记录 | GET /api/organizations/:id/audit-logs?type=index_build | 只返回指定类型的日志 |
| AUDIT-006 | 审计日志导出 | 已有审计记录 | GET /api/organizations/:id/audit-logs?export=csv | 返回 CSV 格式日志 |

## 8. 审计日志 (AUDIT) — 覆盖 AC-8

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| BILL-001 | 订阅套餐升级 | 已有 free 订阅 | POST /api/billing/subscribe (升级到 pro) | 订阅更新，权限升级 |
| BILL-002 | 支付回调处理 | 支付宝/Stripe 支付成功 | webhook 回调 | 订阅状态更新，invoice 创建 |
| BILL-003 | 订阅过期 | 订阅到期未续费 | 到期后 | 降级为 free，功能受限 |
| BILL-004 | 账单查询 | 已有订阅记录 | GET /api/organizations/:id/invoices | 返回账单列表 |
| BILL-005 | 使用量限制 | free 套餐（限制 3 个项目） | 尝试创建第 4 个项目 | 返回 402，提示升级 |
| BILL-006 | 升级后上限即时生效 | 刚完成 pro 升级 | 检查项目/成员数限制 | 新上限立即生效，可创建更多项目 |

## 9. 计费与订阅 (BILL) — 覆盖 AC-9

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| NOTIFY-001 | 企微通知：构建成功 | 已配置企微 webhook | 索引构建完成 | 企微群收到构建成功消息（含项目名、耗时） |
| NOTIFY-002 | 钉钉通知：构建失败 | 已配置钉钉 webhook | 索引构建失败 | 钉钉群收到构建失败消息（含错误信息） |

## 10. 通知模块 (NOTIFY) — 覆盖 AC-10

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| UI-001 | 登录页面 | 未登录 | 访问首页 | 重定向到登录页 |
| UI-002 | Dashboard 加载 | 已登录 | 访问 dashboard | 显示项目列表 + 索引状态 |
| UI-003 | 创建项目工作流 | 已登录 | 点击创建→填写信息→提交 | 项目创建成功，页面刷新 |
| UI-004 | 索引状态实时更新 | 索引构建中 | 停留在项目页 | 状态自动从 running→completed（WebSocket/轮询） |
| UI-005 | 团队管理页面 | 已登录 | 管理团队成员 | 成员列表正确显示 |
| UI-006 | 审计日志页面 | 已有审计记录 | 访问审计页 | 显示操作历史 |
| UI-007 | 响应式布局 | 任意页面 | 在不同视口查看 | 移动端/桌面端均正常显示 |

## 11. 前端仪表板 (UI)

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| E2E-001 | 新用户完整工作流 | 无账号 | 邮箱注册→创建组织→创建团队→绑定仓库→触发索引→等待完成→通过 MCP 查询 | 全流程成功 |
| E2E-002 | CI/CD 自动索引 | 已有项目 + webhook | 推送代码→webhook 触发→索引自动更新→MCP 查询到新内容 | 全流程成功 |
| E2E-003 | Claude Code 集成 | 已有索引 | Claude Code 配置 MCP → 搜索代码 → 查看调用关系 → 影响分析 | 查询结果正确返回 |
| E2E-004 | Cursor 集成 | 已有索引 | Cursor 配置 MCP → 搜索路由 → 查看符号详情 | 查询结果正确返回 |
| E2E-005 | 多租户隔离 | 两个组织各有索引 | 组织 A 用户查询组织 B 项目 | 无法访问，返回 403 |
| E2E-006 | 订阅升级流程 | free 用户 | 升级 pro→支付→功能解锁 | 权限正确升级 |

## 12. 端到端工作流 (E2E)

| Case-ID | 描述 | 前置条件 | 步骤 | 指标 |
|---------|------|----------|------|------|
| PERF-001 | 索引构建性能 | 10K 文件 TS 项目 | 触发全量索引 | ≤15min 完成 |
| PERF-002 | MCP 单查询延迟 | 已有索引 | 发送单条查询 | P50 ≤ 50ms, P99 ≤ 200ms |
| PERF-003 | API 吞吐量 | API 服务运行 | k6 加压 | ≥500 req/s (简单查询) |
| PERF-004 | 并发索引构建 | 10 个项目同时构建 | 同时触发 | 全部成功，无资源竞争 |
| PERF-005 | ≤5K 文件索引 ≤5min | 5K 文件 TS 项目 | POST /api/projects/:id/indexes/build | ≤5min 完成，status=completed |
| PERF-006 | MCP 10 并发 P95 <2s | 已有索引 | k6 发送 10 并发查询 | P95 延迟 <2s，无崩溃 |

## 13. 性能测试 (PERF) — 覆盖 AC-3, AC-11

| Case-ID | 描述 | 前置条件 | 预期结果 |
|---------|------|----------|----------|
| SEC-001 | HTTPS 强制 | HTTP 请求 | 301 重定向到 HTTPS |
| SEC-002 | SQL 注入防护 | 构造恶意查询参数 | Prisma ORM 自动防护，正常返回或 400 |
| SEC-003 | XSS 防护 | 注入恶意 script | 被 CSP/escape 拦截 |
| SEC-004 | CSRF 防护 | 跨站请求 | Token 验证拒绝 |
| SEC-005 | Webhook HMAC 验证 | 伪造 webhook 请求 | HMAC 校验失败，拒绝处理 |
| SEC-006 | 租户隔离：API 越权 | 租户 A token 访问租户 B 项目 | 403 Forbidden |
| SEC-007 | 租户隔离：RLS 验证 | 直接 DB 查询（绕过 API） | PostgreSQL RLS 策略阻止跨租户访问 |
| SEC-008 | 索引文件访问控制 | 直接访问索引文件路径 | 返回 403/404 |

---

## 14. 安全测试 (SEC) — 覆盖 AC-7, AC-12

| Case-ID | 描述 | 前置条件 | 预期结果 |
|---------|------|----------|----------|
| SEC-001 | HTTPS 强制 | HTTP 请求 | 301 重定向到 HTTPS |
| SEC-002 | SQL 注入防护 | 构造恶意查询参数 | Prisma ORM 自动防护，正常返回或 400 |
| SEC-003 | XSS 防护 | 注入恶意 script | 被 CSP/escape 拦截 |
| SEC-004 | CSRF 防护 | 跨站请求 | Token 验证拒绝 |
| SEC-005 | Webhook HMAC 验证 | 伪造 webhook 请求 | HMAC 校验失败，拒绝处理 |
| SEC-006 | 租户隔离：API 越权 | 租户 A token 访问租户 B 项目 | 403 Forbidden |
| SEC-007 | 租户隔离：RLS 验证 | 直接 DB 查询（绕过 API） | PostgreSQL RLS 策略阻止跨租户访问 |
| SEC-008 | 索引文件访问控制 | 直接访问索引文件路径 | 返回 403/404 |

---

## 15. F4 MCP 网关托管 — 覆盖 AC-5, AC-11

> 新增于 T-2026-00266

| Case-ID | 描述 | 前置条件 | 步骤 | 预期结果 |
|---------|------|----------|------|----------|
| F4-001 | HTTP 传输初始化 | mcp-server HTTP 模式已启动 | POST /mcp/message 发送 initialize 请求 | 返回 initialize result，含 server 信息 |
| F4-002 | SSE 推送连接 | HTTP Server 已启动 | GET /mcp/sse | 200，Content-Type: text/event-stream，保持连接 |
| F4-003 | HTTP 端点 tool 调用 | 已 initialize，有项目索引 | POST /mcp/message 发送 tools/call | 返回 tool 执行结果 |
| F4-004 | 会话创建与复用 | 同一 API Key | 两个 agent 分别 initialize | 复用同一个 IndexEngine 实例 |
| F4-005 | 会话超时清理 | 创建会话后等待 | 等待超过 TTL (30min) | 会话被清理，IndexEngine 引用计数减 1 |
| F4-006 | 会话数量上限 | 创建 maxSessions 个会话 | 尝试创建第 maxSessions+1 个 | 返回 429 Too Many Requests |
| F4-007 | 健康检查 | HTTP Server 运行 | GET /mcp/health | 200, `{"status": "ok"}` |
| F4-008 | API Key 认证失败 | 无有效 API Key | POST /mcp/message 不带 key | 401 Unauthorized |
| F4-009 | 多 agent 并发查询 | 同一项目，2 个 agent 连接 | 同时发起 search_code | 两个请求都成功返回，无冲突 |
| F4-010 | 索引连接池命中 | 同一项目已有活跃连接 | 新查询请求该 project | 复用已有 IndexEngine，无重复 open |
| F4-011 | stdio 传输向后兼容 | mcp-server stdio 模式 | 通过 Claude Code stdio 连接 | 正常工作，不受 HTTP 模式影响 |
| F4-012 | 会话 LRU 淘汰 | 超过 maxSessions，有旧会话 | 创建新会话 | 最久未使用的会话被淘汰 |

---

## 测试用例统计

| 模块 | 用例数 | 优先级 | 覆盖 AC |
|------|--------|--------|----------|
| AUTH 认证 | 8 | P0 | AC-2 |
| ORG 组织管理 | 6 | P0 | AC-7 |
| PROJ 项目管理 | 5 | P0 | AC-2 |
| IDX 索引构建 | 10 | P0 | AC-3 |
| WEBHOOK Webhook | 5 | P0 | AC-4 |
| MCP MCP 网关 | 13 | P0 | AC-5, AC-6, AC-11 |
| WRK Worker | 6 | P1 | — |
| AUDIT 审计 | 6 | P1 | AC-8 |
| BILL 计费 | 6 | P1 | AC-9 |
| NOTIFY 通知 | 2 | P1 | AC-10 |
| UI 前端 | 7 | P2 | — |
| E2E 端到端 | 6 | P0 | AC-2~AC-12 |
| PERF 性能 | 6 | P1 | AC-3, AC-11 |
| INFRA 基础设施 | 2 | P0 | AC-1 |
| SEC 安全 | 8 | P1 | AC-7, AC-12 |
| F4 MCP 网关托管 | 12 | P0 | AC-5, AC-11 |
| **总计** | **108** | | **AC-1 ~ AC-12** |
