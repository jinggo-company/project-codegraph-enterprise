# CodeGraph Enterprise — ARCHITECTURE.md

> 对应任务: T-2026-00130 | 项目: P-2026-00020 (CodeGraph Enterprise)
> 基于 PRD: R-2026-00084
> 创建日期: 2026-06-01

## 1. 项目结构（Monorepo）

```
project-codegraph-enterprise/
├── apps/
│   ├── web/                    # Next.js 前端仪表板
│   │   ├── src/
│   │   │   ├── app/            # App Router 页面
│   │   │   │   ├── (auth)/     # 认证相关页面（登录、注册、OAuth回调）
│   │   │   │   ├── (dashboard)/ # 管理面板（布局 + 页面）
│   │   │   │   │   ├── projects/     # 项目管理
│   │   │   │   │   ├── teams/        # 团队管理
│   │   │   │   │   ├── indexes/      # 索引管理
│   │   │   │   │   ├── audit/        # 审计日志
│   │   │   │   │   ├── billing/      # 计费/订阅
│   │   │   │   │   └── settings/     # 账户设置
│   │   │   │   └── api/        # Next.js API Routes（webhook、auth代理）
│   │   │   ├── components/     # 可复用 UI 组件
│   │   │   ├── hooks/          # 自定义 React Hooks
│   │   │   ├── lib/            # 工具函数、API client
│   │   │   ├── stores/         # Zustand stores
│   │   │   └── types/          # TypeScript 类型定义
│   │   ├── public/
│   │   └── next.config.ts
│   │
│   ├── api/                    # Fastify 后端 API 服务
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/       # 认证模块（JWT、OAuth）
│   │   │   │   ├── users/      # 用户管理
│   │   │   │   ├── teams/      # 团队/组织管理
│   │   │   │   ├── projects/   # 项目/仓库管理
│   │   │   │   ├── indexes/    # 索引构建/调度/状态
│   │   │   │   ├── audit/      # 审计日志
│   │   │   │   ├── billing/    # 订阅/计费
│   │   │   │   └── webhooks/   # 外部 webhook（GitHub CI/CD、支付）
│   │   │   ├── plugins/        # Fastify 插件（认证、日志、CORS）
│   │   │   ├── lib/            # 共享工具、配置
│   │   │   └── types/          # 类型定义
│   │   └── test/
│   │
│   ├── mcp-server/             # MCP Server 网关
│   │   ├── src/
│   │   │   ├── server.ts       # MCP Server 入口
│   │   │   ├── tools/          # MCP tools 实现
│   │   │   │   ├── search.ts   # 代码搜索工具
│   │   │   │   ├── callers.ts  # 调用者查询
│   │   │   │   ├── impact.ts   # 影响分析
│   │   │   │   └── symbols.ts  # 符号查询
│   │   │   ├── index-engine/   # CodeGraph 索引引擎适配层
│   │   │   │   ├── engine.ts   # 索引引擎接口
│   │   │   │   ├── local.ts    # 本地 CodeGraph 引擎
│   │   │   │   └── remote.ts   # 远程/托管索引引擎
│   │   │   └── config.ts       # MCP 配置
│   │   └── test/
│   │
│   └── worker/                 # 后台 Worker（索引构建）
│       ├── src/
│       │   ├── jobs/
│       │   │   ├── build-index.ts      # 构建索引任务
│       │   │   ├── sync-index.ts       # 增量同步任务
│       │   │   └── cleanup-index.ts    # 清理过期索引
│       │   ├── runners/
│       │   │   └── codegraph-runner.ts # CodeGraph 执行器
│       │   └── worker.ts       # BullMQ worker 入口
│       └── test/
│
├── packages/
│   ├── db/                     # Prisma schema + 数据库客户端
│   │   ├── schema/
│   │   │   └── index.prisma    # 数据库 schema 定义
│   │   └── src/
│   │       └── client.ts       # Prisma client 导出
│   │
│   ├── config/                 # 共享配置（ESLint、TypeScript等）
│   └── types/                  # 跨应用共享类型
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml          # 本地开发环境
│   │   ├── docker-compose.prod.yml     # 生产环境
│   │   ├── postgres.Dockerfile
│   │   └── nginx/
│   │       └── nginx.conf              # 反向代理配置
│   ├── github-actions/
│   │   └── auto-index.yml              # CI/CD 自动索引 workflow
│   └── k8s/                    # （Phase 4 以后）Kubernetes 部署
│       ├── deployments/
│       └── services/
│
├── docs/                       # 项目文档
│   ├── TECH_STACK.md
│   ├── ARCHITECTURE.md
│   └── TEST_CASES.md
│
├── pnpm-workspace.yaml
├── package.json
├── turbo.json                  # Turborepo 配置
└── README.md
```

## 2. 核心模块设计

### 2.1 多租户架构

```
Organization（组织）
├── Team（团队）
│   ├── Member（成员，带角色: owner/admin/developer/viewer）
│   ├── Project（项目/仓库）
│   │   ├── Index（索引实例，带状态）
│   │   │   ├── Snapshot（索引快照）
│   │   │   └── SyncLog（同步日志）
│   │   └── WebhookConfig（CI/CD webhook 配置）
│   └── Subscription（订阅）
│       ├── Plan（套餐）
│       └── Invoice（账单）
└── AuditLog（审计日志）
```

**数据隔离策略**:
- 每行数据带 `organization_id`
- 中间件层强制 `WHERE organization_id = ?`
- 索引文件按 `org_id/project_id` 物理隔离存储

### 2.2 索引调度模块

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  触发器           │     │  任务队列         │     │  Worker 执行器   │
│                  │     │                  │     │                  │
│  • CI/CD webhook │────▶│  BullMQ Queue    │────▶│  CodeGraph       │
│  • 手动触发       │     │  (build-index)   │     │  Runner          │
│  • 文件监听       │     │  (sync-index)    │     │                  │
│  • 定时重建       │     │  (cleanup-index) │     │  并发控制:       │
│                  │     │                  │     │  • 项目锁         │
│                  │     │                  │     │  • 限流           │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

**关键接口**:

```typescript
// packages/types/src/index.ts
interface IndexJob {
  id: string;
  projectId: string;
  type: 'full' | 'incremental' | 'cleanup';
  status: 'queued' | 'running' | 'completed' | 'failed';
  triggerSource: 'webhook' | 'manual' | 'watcher' | 'schedule';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  stats?: IndexStats;
}

interface IndexStats {
  filesScanned: number;
  symbolsIndexed: number;
  callGraphEdges: number;
  sqliteSizeBytes: number;
  durationMs: number;
}
```

### 2.3 MCP Server 网关

**核心职责**:
- 接收 AI 编程工具的 MCP 请求
- 路由到对应的索引引擎（本地或托管）
- 返回结构化的代码知识图谱查询结果

**MCP Tools 清单**:

| Tool | 输入 | 输出 | 对应 PRD 能力 |
|------|------|------|---------------|
| `search_code` | query, language, project | 匹配文件/符号列表 | 全格式搜索 |
| `get_symbol` | symbol_name, kind | 符号详情（位置、签名、文档） | 符号关系 |
| `get_callers` | symbol_name | 调用者列表 | 影响分析 |
| `get_callees` | symbol_name | 被调用者列表 | 影响分析 |
| `get_impact` | file_path or symbol | 完整影响半径 | 影响分析 |
| `search_routes` | url_pattern, framework | 路由→处理器映射 | Web框架路由识别 |
| `search_fulltext` | query, filters | FTS5 搜索结果 | 全文搜索 |

### 2.4 认证与授权

```
┌──────────────────────────────────────────────────────┐
│                   Auth Layer                          │
│                                                       │
│  NextAuth.js v5                                       │
│  ├── OAuth: GitHub / GitLab / 企业 IdP (SAML/OIDC)    │
│  ├── Email/Password (备用)                            │
│  └── API Key (MCP 服务端认证)                          │
│                                                       │
│  RBAC:                                                │
│  ├── owner: 全权限                                    │
│  ├── admin: 团队/项目/索引管理                         │
│  ├── developer: 索引查询、触发重建                     │
│  └── viewer: 只读查询                                 │
└──────────────────────────────────────────────────────┘
```

## 3. 数据流

### 3.1 索引构建流程

```
1. 用户通过 Dashboard 创建项目 → 绑定 Git 仓库
2. CI/CD Webhook 或手动触发 → API 创建 IndexJob → 推入 BullMQ
3. Worker 拉取任务:
   a. clone/fetch 代码库到临时目录
   b. 调用 CodeGraph 引擎扫描代码
   c. 生成 SQLite 索引文件
   d. 上传索引快照到对象存储 (MinIO/S3)
   e. 更新数据库状态 + 统计信息
4. Dashboard 收到完成通知 → 索引可用
5. MCP Server 可响应该项目的查询请求
```

### 3.2 增量同步流程

```
1. 文件监听触发 / CI/CD 推送事件
2. 比对上次索引的文件 hash
3. 仅索引变更的文件（增量模式）
4. 合并到现有 SQLite 索引
5. 更新索引版本标记
```

### 3.3 AI Agent 查询流程

```
Claude Code / Cursor / Codex
       │
       │ MCP Protocol (stdio / HTTP)
       ▼
┌──────────────────┐
│  MCP Server 网关  │
│  (认证 + 路由)    │
└────────┬─────────┘
         │ 查询: project_id + tool + params
         ▼
┌──────────────────┐
│  索引引擎          │
│  (CodeGraph +     │
│   SQLite/FTS5)    │
└────────┬─────────┘
         │ 结构化结果
         ▼
┌──────────────────┐
│  MCP Server       │
│  → 返回给 Agent   │
└──────────────────┘
```

## 4. 接口定义（核心 API）

### 4.1 REST API 路由

```
# 认证
POST   /api/auth/login
POST   /api/auth/register
POST   /api/auth/oauth/:provider/callback
POST   /api/auth/apikey

# 组织/团队
GET    /api/organizations
POST   /api/organizations
GET    /api/organizations/:orgId/teams
POST   /api/organizations/:orgId/teams
GET    /api/teams/:teamId/members
POST   /api/teams/:teamId/members

# 项目
GET    /api/teams/:teamId/projects
POST   /api/teams/:teamId/projects
GET    /api/projects/:projectId
PATCH  /api/projects/:projectId
DELETE /api/projects/:projectId

# 索引
GET    /api/projects/:projectId/indexes
POST   /api/projects/:projectId/indexes/build
POST   /api/projects/:projectId/indexes/sync
GET    /api/indexes/:indexId/status
GET    /api/indexes/:indexId/stats

# Webhook
POST   /api/webhooks/github
POST   /api/webhooks/gitlab
POST   /api/webhooks/ci

# 审计
GET    /api/organizations/:orgId/audit-logs

# 计费
GET    /api/organizations/:orgId/subscription
POST   /api/billing/webhook/:provider
GET    /api/organizations/:orgId/invoices

# MCP (独立端口或路径)
POST   /mcp/message          # MCP 2024-11-05 protocol
GET    /mcp/health            # 健康检查
```

## 5. 部署架构

### 5.1 MVP 部署（Docker Compose）

```
nginx (443/80)
├── web:3000 (Next.js)
├── api:4000 (Fastify)
├── mcp-server:5000 (MCP Gateway)
├── postgres:5432
├── redis:6379
├── minio:9000 (索引存储)
└── worker: (BullMQ Worker，与 CodeGraph 引擎同进程)
```

### 5.2 生产扩展（Phase 4+）

- 水平扩展 API Worker 实例
- 索引构建独立集群（可弹性扩缩容）
- 多区域部署 + 读写分离 PostgreSQL
- Kubernetes 编排

## 6. 安全设计

| 层面 | 措施 |
|------|------|
| 传输 | TLS 1.3 全站强制 HTTPS |
| 存储 | PostgreSQL TDE、S3 SSE-KMS |
| 认证 | JWT + refresh token，API Key 轮转 |
| 授权 | RBAC + 行级多租户隔离 |
| 审计 | 全量操作日志（不可篡改） |
| 索引隔离 | 按 org/project 物理文件隔离，sandbox 执行 CodeGraph |
| CI/CD | Webhook HMAC 验证、IP 白名单 |
