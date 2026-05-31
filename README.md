# CodeGraph Enterprise

团队级代码知识图谱管理平台 — 基于 [colbymchenry/codegraph](https://github.com/colbymchenry/codegraph) 构建

## 概述

CodeGraph Enterprise 是面向中小研发团队的代码知识图谱 SaaS 平台，提供集中索引管理、CI/CD 预构建索引、跨项目搜索、角色权限、审计日志。

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

## 文档

| 文档 | 说明 |
|------|------|
| [TECH_STACK.md](docs/TECH_STACK.md) | 技术栈、版本、依赖清单 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、模块设计、数据流 |
| [TEST_CASES.md](docs/TEST_CASES.md) | 测试案例框架（77 条用例） |

## 立项信息

- Gate: G-2026-00050
- Approved: 2026-06-01
- Lead Dev: quanchen
