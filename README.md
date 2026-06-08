# CodeGraph Enterprise

团队级代码知识图谱管理平台 — 基于 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 构建

## 概述

CodeGraph Enterprise 是面向中小研发团队的代码知识图谱 SaaS 平台，提供集中索引管理、CI/CD 预构建索引、跨项目搜索、角色权限、审计日志。

## 交付里程碑

| 里程碑 | 任务 | 状态 |
|--------|------|------|
| F0 架构设计 | T-2026-00262 | ✅ done |
| F1 多租户 SaaS 平台（团队注册、项目管理、角色权限） | T-2026-00263 | ✅ 完成 |
| F2 集中索引管理（Web 控制台、索引状态、手动触发重建） | T-2026-00264 | pending |
| F3 CI/CD 自动索引构建（GitHub/GitLab Webhook、分支过滤） | T-2026-00265 | ✅ 完成 |

## 快速开始

### 前置条件

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- Docker & Docker Compose >= 2.27.0

### 安装

```bash
# 安装依赖
pnpm install

# 启动基础设施（PostgreSQL + Redis + MinIO）
docker compose -f infra/docker/docker-compose.yml up -d

# 生成 Prisma 客户端
pnpm --filter @codegraph/db run db:generate

# 推送数据库 schema
pnpm --filter @codegraph/db run db:push
```

### 开发

```bash
# 启动所有应用（web + api + mcp-server + worker）
pnpm dev

# 单独启动某个 app
pnpm --filter @codegraph/api dev       # API on :4000
pnpm --filter @codegraph/web dev        # Web on :3000
pnpm --filter @codegraph/mcp-server dev # MCP Server (stdio)
pnpm --filter @codegraph/worker dev     # BullMQ Worker
```

### 构建

```bash
pnpm build
```

### 测试

```bash
pnpm test
```

## 项目结构

```
project-codegraph-enterprise/
├── apps/
│   ├── web/            # Next.js 15 前端仪表板 (port 3000)
│   ├── api/            # Fastify 后端 API 服务 (port 4000)
│   ├── mcp-server/     # MCP Server 网关 (stdio)
│   └── worker/         # BullMQ 后台 Worker
├── packages/
│   ├── db/             # Prisma schema + 数据库客户端
│   ├── config/         # 共享 TypeScript / ESLint 配置
│   └── types/          # 跨应用共享类型
├── infra/
│   └── docker/
│       ├── docker-compose.yml      # 本地开发环境
│       └── nginx/nginx.conf        # 反向代理
├── docs/
│   ├── TECH_STACK.md
│   ├── ARCHITECTURE.md
│   └── TEST_CASES.md
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## 基础设施服务

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5433 | 多租户元数据存储 |
| Redis | 6379 | 缓存 + BullMQ 任务队列 |
| MinIO API | 9000 | 索引快照对象存储 |
| MinIO Console | 9001 | MinIO 管理界面 |
| Web (Next.js) | 3000 | 前端仪表板 |
| API (Fastify) | 4000 | REST API + Swagger Docs (`/docs`) |
| MCP Server | stdio | MCP 协议网关 |

## 技术栈

详见 [docs/TECH_STACK.md](docs/TECH_STACK.md)

- **前端**: Next.js 15 / React 19 / Tailwind CSS / shadcn/ui
- **后端**: Fastify / TypeScript / Prisma / BullMQ
- **数据库**: PostgreSQL 16 / Redis 7
- **MCP**: @modelcontextprotocol/sdk
- **对象存储**: MinIO (S3 兼容)
- **工具**: pnpm workspace / Turborepo / Vitest

## F1 已完成模块清单

| 模块 | API 路由 | 功能 |
|------|----------|------|
| Auth | `/api/auth/register`, `/api/auth/oauth/github`, `/api/auth/oauth/gitlab`, `/api/auth/me`, `/api/auth/apikey` | 邮箱注册、GitHub/GitLab OAuth、JWT/API Key 认证、密钥轮转 |
| Organizations | `/api/organizations` (CRUD) | 组织创建（自动创建默认团队 + 免费订阅） |
| Teams | `/api/organizations/:id/teams`, `/api/teams/:id/members` | 团队 CRUD、成员邀请/移除、角色管理 |
| Projects | `/api/teams/:id/projects`, `/api/projects/:id` (CRUD) | 项目 CRUD、订阅限额检查（Free 3 项目） |
| Indexes | `/api/projects/:id/indexes/build`, `/api/indexes/:id/status` | 手动触发索引、状态查询 |
| Webhooks | `/api/webhooks/github`, `/api/webhooks/gitlab` | GitHub/GitLab Push Webhook + HMAC 验证 |
| Audit | `/api/organizations/:id/audit-logs` | 只读审计日志（过滤、分页） |
| Billing | `/api/organizations/:id/subscription`, `/api/billing/subscribe`, `/api/billing/webhook/:provider` | 订阅查询/升级、支付回调 |

### F1 覆盖 AC

| AC | 覆盖状态 | Case-IDs |
|----|----------|----------|
| AC-1 | ✅ | INFRA-001, INFRA-002 |
| AC-2 | ✅ | AUTH-001 ~ AUTH-008 |
| AC-3 | ✅ | IDX-001, IDX-002 |
| AC-7 | ✅ | ORG-006, SEC-006 |

## 文档

| 文档 | 说明 |
|------|------|
| [TECH_STACK.md](docs/TECH_STACK.md) | 技术栈、版本、依赖清单 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、模块设计、数据流 |
| [TEST_CASES.md](docs/TEST_CASES.md) | 测试案例框架（96 条用例） |
| [TEST_REPORT.md](docs/TEST_REPORT.md) | T-2026-00263 测试报告 |

## 立项信息

- Gate: G-2026-00050
- Approved: 2026-06-01
- Lead Dev: quanchen
