# TECH_STACK.md — CodeGraph Enterprise

## Overview

Full-stack TypeScript monorepo for a code knowledge graph platform.

## Core Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >= 20 |
| Language | TypeScript | >= 5.3 |
| Package Manager | pnpm | >= 9 |
| Build System | Turborepo | latest |
| Database | PostgreSQL | >= 15 |
| ORM | Prisma | >= 5 |
| Cache/Queue | Redis | >= 7 |
| Queue Library | BullMQ | >= 4 |
| API Framework | Fastify | >= 4 |
| Frontend | Next.js | >= 14 |
| Validation | Zod | >= 3 |
| Test Framework | Vitest | >= 1 |
| CSS | Tailwind CSS | >= 3 |
| Auth | NextAuth.js v5 | latest |

## Key Dependencies (API)

```json
{
  "fastify": "^4.x",
  "@fastify/cors": "^9.x",
  "@fastify/cookie": "^9.x",
  "@fastify/swagger": "^8.x",
  "@fastify/swagger-ui": "^3.x",
  "bullmq": "^4.x",
  "ioredis": "^5.x",
  "zod": "^3.x",
  "@fastify/jwt": "^8.x"
}
```

## Key Dependencies (Worker)

```json
{
  "bullmq": "^4.x",
  "ioredis": "^5.x",
  "tree-sitter": "^0.20.x",
  "@tree-sitter-grammars/*": "latest"
}
```

## Key Dependencies (DB)

```json
{
  "@prisma/client": "^5.x",
  "prisma": "^5.x"
}
```

## Infrastructure

- **Container**: Docker + docker-compose
- **Storage**: MinIO (S3-compatible)
- **CI/CD**: GitHub Actions
- **Monitoring**: OpenTelemetry + Prometheus
