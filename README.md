# CodeGraph Enterprise

Code knowledge graph platform with multi-tenant SaaS support.

## Architecture

Monorepo managed with pnpm workspaces + Turborepo:

```
apps/
  api/          — Fastify REST API (port 4000)
  web/          — Next.js frontend (port 3000)
  worker/       — BullMQ job workers
  mcp-server/   — MCP Server gateway
packages/
  db/           — Prisma client + schema
  types/        — Shared TypeScript types
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- PostgreSQL >= 15
- Redis >= 7

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env

# Run database migrations
pnpm --filter @codegraph/db db:migrate

# Start all services
pnpm dev
```

## Development

```bash
pnpm dev              # Start all services in dev mode
pnpm build            # Build everything
pnpm test             # Run all tests
pnpm --filter @codegraph/api test  # Run API tests only
```

## Key Services

- **API** (`apps/api`): Fastify server with authentication, RBAC, index management
- **Worker** (`apps/worker`): BullMQ consumers for build/sync/cleanup jobs
- **DB** (`packages/db`): Prisma ORM with PostgreSQL
- **Types** (`packages/types`): Shared TypeScript types
