# CodeGraph Enterprise — TECH_STACK.md

> 对应任务: T-2026-00262 | 项目: P-2026-00034 (CodeGraph Enterprise)
> 基于 PRD: spec-writes/P-2026-00034/docs/PRD.md
> 更新日期: 2026-06-09 | 原创建: 2026-06-01
> 更新: T-2026-00266 新增 F4 MCP Server 网关托管章节

## 1. 项目定位

CodeGraph Enterprise 是基于开源 [CodeGraph](https://github.com/colbymchenry/codegraph) 构建的企业级代码知识图谱 SaaS 平台。为 AI 编程工具（Claude Code、Codex、Cursor 等）提供预索引代码知识图谱，实现集中索引管理、多租户隔离、CI/CD 自动索引、审计日志和团队协作。

## 2. 核心技术栈

### 2.1 索引引擎（上游依赖）

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| CodeGraph Core | TypeScript + Rust | 最新稳定版（跟踪 upstream） | 符号解析、调用图构建、知识图谱索引（MIT, 35K+ stars） |
| SQLite | C 库（嵌入式） | 3.45+ | 本地索引存储，FTS5 全文搜索 |
| tree-sitter | C/Rust | 0.22+ | 多语言语法解析（20+ 语言支持） |

### 2.2 后端服务

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Node.js | 22 LTS | 托管索引服务、MCP Server 网关 |
| 框架 | Fastify | 4.28+ | 高性能 HTTP/API 服务（替代 Express，更适合高吞吐场景） |
| 语言 | TypeScript | 5.5+ | 全栈类型安全 |
| 数据库 | PostgreSQL | 16+ | 多租户元数据、用户管理、审计日志、计费 |
| ORM | Prisma | 5.15+ | 类型安全数据库访问 |
| MCP SDK | @modelcontextprotocol/sdk | 1.6+ | MCP Server/Client 协议实现 |
| 任务队列 | BullMQ | 5.0+ | Redis-backed 任务调度（索引构建、CI/CD 触发、Webhook 去重） |
| 缓存/队列存储 | Redis | 7.2+ | 会话缓存、任务队列、索引状态锁、并发构建锁 |

### 2.3 前端仪表板

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 框架 | Next.js | 15 App Router | SSR/SSG，适合管理面板 |
| UI 库 | React | 19 | 组件化开发 |
| 样式 | Tailwind CSS | 3.4+ | 原子化 CSS，快速迭代 |
| 组件库 | shadcn/ui | 最新 | 基于 Radix UI 的可访问组件 |
| 状态管理 | Zustand | 4.5+ | 轻量级状态管理 |
| 图表 | Recharts | 2.12+ | 数据可视化（索引统计、使用分析） |
| 认证 | NextAuth.js v5 | 5.0+ | OAuth/SSO 集成（GitHub/GitLab/企业 IdP） |

### 2.4 基础设施

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 容器化 | Docker | 26+ | 服务容器化部署 |
| 编排 | Docker Compose | 2.27+ | MVP 阶段 |
| CI/CD | GitHub Actions | latest | 自动索引触发、测试流水线 |
| 反向代理 | Nginx | 1.25+ | SSL 终止、路由分发 |
| 日志 | Pino + Loki | 最新 | 结构化日志采集 |
| 监控 | Prometheus + Grafana | 最新 | 服务指标监控 |
| 对象存储 | MinIO / S3 兼容 | 最新 | 索引快照存储、备份 |

### 2.5 支付与计费

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 支付网关 | 支付宝 SDK / Stripe | 最新 | 订阅支付（国内优先支付宝，海外 Stripe） |
| Webhook | Fastify webhook handler | 内置 | 支付状态回调处理 |

## 3. 依赖关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端仪表板 (Next.js)                     │
│              多租户管理 / 索引监控 / 审计 / 计费                  │
└──────────────┬──────────────────────────────┬────────────────┘
               │ REST/GraphQL                  │ WebSocket
               ▼                               ▼
┌──────────────────────────────┐  ┌────────────────────────────┐
│   API 网关 (Fastify + TS)     │  │   MCP Server 网关           │
│  ├─ 用户/认证                  │  │  ├─ Claude Code 集成        │
│  ├─ 项目/团队管理               │  │  ├─ Cursor 集成            │
│  ├─ 索引调度                   │  │  ├─ Codex 集成             │
│  ├─ 审计日志                   │  │  └─ 其他 MCP 客户端         │
│  └─ 计费/订阅                  │  │
└───────┬──────────────┬───────┘  └───────────┬────────────────┘
        │              │                      │
        ▼              ▼                      ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐
│ PostgreSQL   │ │    Redis     │ │   CodeGraph 索引引擎       │
│ (多租户元数据) │ │ (缓存/队列)   │ │ (TS + Rust + SQLite)      │
└──────────────┘ └──────────────┘ │  ├─ 符号解析                │
                                 │  ├─ 调用图构建              │
                                 │  ├─ 文件监听 (inotify等)    │
                                 │  └─ FTS5 全文搜索           │
                                 └────────────────────────────┘
```

## 4. 开发工具

| 工具 | 用途 |
|------|------|
| pnpm | 包管理（workspace monorepo） |
| ESLint + Prettier | 代码质量 |
| Vitest | 单元测试 |
| Playwright | E2E 测试 |
| Docker Compose | 本地开发环境 |
| tRPC (可选) | 类型安全 API |

## 5. 技术风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| 上游 CodeGraph 单人维护 | 核心功能可能停滞 | fork 维护、关注社区 PR |
| MCP 协议版本碎片化 | 各 agent 兼容性 | 实现协议适配层，抽象 MCP 版本差异 |
| Node.js 单线程索引构建 | 大型代码库索引慢 | 多 worker 进程、增量索引 |
| 国内 AI 工具渗透率低 | 市场需求不足 | 同时支持国际版 + 教育市场 |
| Webhook 并发触发重复构建 | 资源浪费、索引损坏 | Redis 分布式锁 + BullMQ 去重 |
| 多租户数据泄露 | 安全事故 | 行级 RLS + 物理文件隔离 + 中间件强制 org_id |

## 5b. F4 MCP Server 网关托管 — 技术选型

> 新增于 T-2026-00266

F4 核心目标：提供统一的 MCP HTTP/SSE 端点，多个 AI agent（Claude Code/Cursor/Codex）可连接同一平台实例，共享同一份索引数据，实现多 agent 会话复用。

### 新增组件

| 组件 | 技术 | 版本 | 说明 |
|------|------|------|------|
| HTTP 传输层 | @modelcontextprotocol/sdk Streamable HTTP | 1.6+ | MCP Streamable HTTP Transport，统一端点 |
| SSE | 原生 Node.js | 内置 | Server-Sent Events，用于 server→client 推送 |
| 会话管理 | 内存 LRU Map + Redis | - | 多 agent 会话复用、会话状态持久化 |
| Fastify 插件 | fastify | 4.28+ | 注册 `/mcp` 路由，处理 initialize/tool call |

### 会话复用架构

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Claude Code │  │   Cursor    │  │   Codex     │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │ HTTP/SSE       │ HTTP/SSE       │ HTTP/SSE
       └────────────────┼────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │   MCP Gateway (HTTP)   │
            │  ┌─────────────────┐  │
            │  │ Session Manager │  │
            │  │ (LRU + Redis)   │  │
            │  └─────────────────┘  │
            │  ┌─────────────────┐  │
            │  │  Shared Engine  │  │
            │  │ (Index Pool)    │  │
            │  └─────────────────┘  │
            └───────────┬───────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │   SQLite Index Files   │
            │   (按 org/project 隔离) │
            └───────────────────────┘
```

### 关键设计决策

1. **单一 HTTP 端点**：所有 MCP 通信统一走 `/mcp` 路径（MCP Streamable HTTP 规范）
2. **会话复用**：多个 agent 通过 API Key 关联到同一项目，共享同一个 IndexEngine 实例池
3. **连接池化**：SQLite 连接按 project 缓存，避免重复打开/关闭
4. **会话超时**：空闲会话 30min 自动清理，释放连接

---

## 6. AC 覆盖矩阵

| AC | 验收项 | 覆盖模块 | 验证方式 |
|----|--------|----------|----------|
| AC-1 | Docker Compose 一键启动，健康检查 200 | infra/docker, API /health | `docker compose up` + curl |
| AC-2 | 团队注册/登录（企微/钉钉 SSO 或邮箱） | auth, web | OAuth 登录 + 邮箱注册 |
| AC-3 | 手动触发索引构建 ≤5min（≤5K 文件） | indexes, worker | POST /api/projects/:id/indexes/build |
| AC-4 | GitHub Webhook push → 2min 自动触发索引 | webhooks, worker | POST /api/webhooks/github + 状态轮询 |
| AC-5 | MCP 端点连接 Claude Code，返回图谱数据 | mcp-server | initialize + tool 调用 |
| AC-6 | 跨项目搜索：2 个项目一次查询返回双方结果 | mcp-server, indexes | search_code multi-project |
| AC-7 | 多租户隔离：A 项目对 B 不可见 | auth, RBAC, RLS | API 越权测试 → 403 |
| AC-8 | 审计日志：构建/查询/操作记录可过滤 | audit | GET /audit-logs + filter |
| AC-9 | 订阅升级后上限即时生效 | billing | 升级套餐 → 验证限额 |
| AC-10 | 企微/钉钉通知：构建成功/失败推送 | webhooks, notifications | 模拟构建完成 → 验证推送 |
| AC-11 | MCP Server 10 并发查询 P95 <2s | mcp-server, infra | k6 压测 |
| AC-12 | 安全加固：鉴权/HTTPS/SQL 注入/RLS | auth, security, db | 渗透测试 + RLS 验证 |
