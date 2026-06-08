# CodeGraph Enterprise — PRD v1

## 需求概述

CodeGraph 是为 AI 编程工具（Claude Code/Codex/Cursor/Gemini CLI 等）提供预索引代码知识图谱的开源项目（MIT，35K+ stars）。实测平均节省 25% 成本、57% token、62% 工具调用。原版仅支持单机本地运行，无法直接用于团队协作。

CodeGraph Enterprise 基于 CodeGraph OSS 构建团队级代码知识图谱管理平台，提供集中索引管理、CI/CD 预构建索引、跨项目搜索、审计日志、角色权限、多租户安全隔离。面向已部署 AI 编程工具的研发团队，解决 token 成本高企、代码索引无法共享、合规审计缺失等痛点。

## 产品定位

面向已使用 Claude Code/Codex/Cursor 的中小型研发团队（10-200 人），提供 CodeGraph 代码知识图谱的 SaaS 托管与私有化部署服务。核心价值：一次索引、全团队复用、CI/CD 自动构建、审计合规可追溯。

## 目标客户

- **已部署 AI 编程工具的研发团队（10-200 人）**：token 成本高企，需要集中索引复用降本
- **AI 编程工具治理负责人 / DevOps 团队**：需要审计日志、权限管控、合规追踪
- **技术咨询公司**：为客户搭建 AI 编程工具工作流，需要可交付的平台产品

## 核心功能（MoSCoW）

### Must Have
- **F1: 多租户 SaaS 平台** — 团队注册、项目管理、角色权限（管理员/成员/只读）
- **F2: 集中索引管理** — Web 控制台浏览项目索引状态、手动触发重建、查看索引元数据（文件数/语言分布/更新时间）
- **F3: CI/CD 自动索引构建** — GitHub/GitLab Webhook 触发 push 后自动重建索引，支持分支过滤
- **F4: MCP Server 网关托管** — 统一 MCP 端点，团队成员通过 Claude Code/Cursor 连接平台获取图谱数据，多 agent 会话复用同一索引
- **F5: 跨项目搜索** — 一次查询覆盖团队所有已索引项目，支持符号名/调用链/全文检索

### Should Have
- **F6: 审计日志** — 索引构建记录、查询记录、成员操作日志，支持导出
- **F7: 计费/订阅模块** — 微信/支付宝订阅支付，套餐升级/降级，用量统计与超限提醒
- **F8: 企微/钉钉集成** — 索引构建通知、权限审批流程、用量告警推送

### Could Have
- **F9: 代码变更影响分析看板** — 可视化展示改动波及范围（调用者/被调用者/依赖链）
- **F10: 索引质量评分** — 基于索引完整度、语言覆盖率、同步延迟给出健康评分

### Won't Have (MVP)
- F11: 代码自动补全/IDE 插件（CodeGraph 本身不提供此能力）
- F12: 代码问答/Chat on Code（非 CodeGraph 核心定位）

## 技术栈建议
- **索引引擎**: CodeGraph OSS（TypeScript/Rust/SQLite）
- **MCP 协议**: Anthropic MCP SDK（TypeScript）
- **后端**: FastAPI (Python) / Express (Node.js) — REST API + Webhook 处理
- **前端**: Next.js + TailwindCSS + shadcn/ui（管理控制台）
- **任务队列**: Celery + Redis（CI/CD 异步索引构建）
- **存储**: 对象存储（索引数据、快照）+ PostgreSQL（用户/权限/元数据）
- **多租户**: 逻辑隔离（租户 ID 列级隔离）+ 行级安全策略（RLS）
- **部署**: Docker Compose（开发/演示）→ K8s（生产多租户）
- **支付**: 微信支付/支付宝（替代 Stripe）

## 验收标准 (AC)
- AC-1: Docker Compose 一键启动，管理控制台可访问，健康检查返回 200
- AC-2: 团队注册与登录（支持企微/钉钉 SSO 或邮箱密码），创建项目成功
- AC-3: 手动触发项目索引构建，5 分钟内完成（≤5K 文件项目），状态可见
- AC-4: 配置 GitHub Webhook，push 代码后 2 分钟内自动触发索引重建，构建日志可查
- AC-5: 通过 MCP 端点连接 Claude Code/Cursor，执行一次代码查询，验证返回图谱数据（符号关系/调用链）
- AC-6: 跨项目搜索：索引 2 个项目后，一次查询同时返回两个项目的匹配结果
- AC-7: 多租户隔离：租户 A 的项目和索引对租户 B 不可见，API 调用返回 403
- AC-8: 审计日志：索引构建、查询、成员操作均记录在案，支持按时间/操作类型过滤
- AC-9: 计费模块：订阅套餐升级后，团队可用项目数/成员数上限即时生效
- AC-10: 企微/钉钉通知：索引构建成功/失败推送消息到指定群
- AC-11: 压测：MCP Server 支持 10 个并发查询，P95 响应延迟 <2s（含索引加载）
- AC-12: 安全加固：API 鉴权、HTTPS 强制、SQL 注入防护、租户数据行级隔离

## 测试场景

### 场景 1：研发团队搭建 CodeGraph Enterprise 并接入 CI/CD
**用户角色**: 研发负责人小王（50 人团队，已在使用 Claude Code/Cursor）
**操作路径**:
1. 注册 CodeGraph Enterprise 团队账号，选择"团队版"套餐
2. 在控制台创建第一个项目 "backend-api"，绑定 GitHub 仓库
3. 手动触发一次索引构建，等待完成
4. 在 MCP Server 配置页面获取 MCP 端点 URL 和 API Key
5. 在 Claude Code 中配置 MCP 端点，连接 CodeGraph Enterprise
6. 执行代码查询 "find all callers of UserService.authenticate()" → 验证返回调用链
7. 在 GitHub 仓库设置 Webhook，指向 CodeGraph Enterprise 回调地址
8. 提交一次代码 push → 观察控制台，确认 Webhook 收到事件并自动触发索引重建
**破坏性测试**: 同一项目同时收到 3 个 Webhook push 事件 → 系统应队列化处理，不重复构建

### 场景 2：跨团队协作与权限管控
**用户角色**: DevOps 负责人小李
**操作路径**:
1. 在控制台管理团队成员，添加 3 名成员（2 个开发者、1 个只读审计员）
2. 开发者 A 创建项目 "frontend-app"，配置索引
3. 只读审计员 B 登录，可查看 "backend-api" 和 "frontend-app" 的索引状态和审计日志，但无法修改配置
4. 跨项目搜索：搜索 "getUser" 符号 → 返回 backend-api 和 frontend-app 中所有匹配
5. 查看审计日志，确认所有查询和构建操作均有记录
**破坏性测试**: 开发者 B 尝试访问租户 C 的项目 → 返回 403 Forbidden

### 场景 3：MCP Server 高并发查询
**用户角色**: AI 编程工具重度使用者（同时开 3 个 Claude Code 会话）
**操作路径**:
1. 打开 3 个终端，各启动一个 Claude Code 会话
2. 3 个会话均配置同一 CodeGraph Enterprise MCP 端点
3. 同时在不同会话中执行代码查询
4. 验证 3 个查询均在 2s 内返回结果，无冲突或数据混乱
5. 在审计日志中查看 3 条查询记录
**破坏性测试**: 10 个并发查询同时发起 → 系统不崩溃，P95 延迟 <2s，失败查询返回明确错误

## 测试策略
- **单元测试**: 租户隔离逻辑、Webhook 解析、MCP 协议封装、计费计算
- **集成测试**: GitHub/GitLab Webhook 端到端、MCP Server 查询链路、企微/钉钉通知
- **E2E 测试**: 完整用户流程（注册 → 创建项目 → 索引构建 → MCP 查询 → 跨项目搜索）
- **多租户安全测试**: 行级隔离验证、API 鉴权绕过尝试、SSO 集成校验
- **性能测试**: MCP Server 并发查询压测、索引构建性能、Webhook 处理吞吐
- **CI/CD 集成测试**: 使用 GitHub Actions 模拟 push 事件流
