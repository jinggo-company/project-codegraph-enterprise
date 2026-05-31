# ARCHITECTURE.md — CodeGraph Enterprise

## System Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Web App   │────▶│   API       │────▶│  PostgreSQL │
│  (Next.js)  │     │  (Fastify)  │     │  (Prisma)   │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                     ┌─────┴─────┐
                     │   Redis   │◀──── BullMQ queues
                     └─────┬─────┘
                           │
                     ┌─────┴─────┐
                     │  Worker   │
                     │ (BullMQ)  │
                     └───────────┘
```

## Module Directory Structure

```
apps/api/src/
├── server.ts                    # Fastify app entry point
├── plugins/
│   ├── auth.ts                  # JWT authentication plugin
│   └── rbac.ts                  # Role-based access control
├── modules/
│   ├── auth/                    # Auth endpoints (login, refresh)
│   ├── organizations/           # Org CRUD
│   ├── teams/                   # Team CRUD
│   ├── projects/                # Project CRUD
│   ├── indexes/                 # Index management (T-133)
│   │   └── index.ts             # Index REST API routes
│   └── webhooks/                # GitHub webhook handler
├── lib/
│   ├── audit.ts                 # Audit log helper
│   ├── concurrency.ts           # Redis project locks + rate limiting
│   ├── scheduler.ts             # BullMQ queue setup + enqueue logic
│   └── storage.ts               # S3/MinIO storage helper
```

## Index Scheduler Architecture

### BullMQ Queue Pipeline

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  build-index     │    │  sync-index      │    │  cleanup-index   │
│  (Queue)         │    │  (Queue)         │    │  (Queue)         │
│                  │    │                  │    │                  │
│  - full rebuild  │    │  - delta detect  │    │  - purge old     │
│  - parse all     │    │  - merge diff    │    │  - prune DB      │
│  - build graph   │    │  - update edges  │    │  - free space    │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Index State Machine

```
QUEUED ──▶ RUNNING ──▶ COMPLETED
                  │
                  └──▶ FAILED (with error field)
```

### Concurrency Control

- **Project Lock**: Redis `SETNX` with TTL (1 hour max)
- **Rate Limiting**: Redis sorted set, max 10 requests per minute per project
- **tryAcquireForIndex()**: atomic lock + rate check combo

### Prisma Models

- **Index**: Core index record with status tracking
- **IndexStats**: Per-index statistics (files scanned, symbols, graph edges)
- **Snapshot**: S3/MinIO storage references for index artifacts
- **SyncLog**: Incremental sync history

## API Endpoints (Index Module)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects/:id/indexes/build` | Queue full index build |
| POST | `/api/projects/:id/indexes/sync` | Queue incremental sync |
| GET | `/api/projects/:id/indexes` | List all indexes for project |
| GET | `/api/indexes/:indexId/status` | Get index status |
| GET | `/api/indexes/:indexId/stats` | Get index statistics |
