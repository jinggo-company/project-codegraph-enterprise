// Integration tests for IDX module (T-2026-00133)
// Index Scheduler API + BullMQ Queues

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import authPlugin, { generateAccessToken } from '../src/plugins/auth';
import rbacPlugin from '../src/plugins/rbac';
import indexRoutes from '../src/modules/indexes/index.js';

// ─── Mock Prisma (hoisted) ───

const mocks = vi.hoisted(() => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    index: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    indexStats: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    snapshot: {
      findMany: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
  },
  enqueueIndexJob: vi.fn().mockResolvedValue({ id: 'job-001' }),
  acquireProjectLock: vi.fn().mockResolvedValue(true),
  releaseProjectLock: vi.fn().mockResolvedValue(undefined),
  checkRateLimit: vi.fn().mockResolvedValue(true),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@codegraph/db', () => ({
  get prisma() { return mocks.prisma; },
}));

vi.mock('../src/lib/scheduler.js', () => ({
  get enqueueIndexJob() { return mocks.enqueueIndexJob; },
  get fullIndexQueue() { return { add: vi.fn() }; },
  get incrementalIndexQueue() { return { add: vi.fn() }; },
  get cleanupQueue() { return { add: vi.fn() }; },
}));

vi.mock('../src/lib/concurrency.js', () => ({
  get acquireProjectLock() { return mocks.acquireProjectLock; },
  get releaseProjectLock() { return mocks.releaseProjectLock; },
  get checkRateLimit() { return mocks.checkRateLimit; },
}));

vi.mock('../src/lib/audit.js', () => ({
  get createAuditLog() { return mocks.createAuditLog; },
}));

// ─── Test Helpers ───

const JWT_SECRET = 'test-secret-key-for-testing-purposes-only-32chars!';

const TEST_ORG = { id: 'org-001', name: 'Test Org', slug: 'test-org', createdAt: new Date(), updatedAt: new Date() };
const TEST_TEAM = { id: 'team-001', name: 'default', organizationId: 'org-001', createdAt: new Date() };

const TEST_MEMBER_DEV = {
  id: 'member-002',
  teamId: 'team-001',
  userId: 'user-001',
  role: 'DEVELOPER',
  joinedAt: new Date(),
  team: { ...TEST_TEAM, organization: TEST_ORG },
};

const TEST_PROJECT = {
  id: 'proj-001',
  teamId: 'team-001',
  name: 'test-project',
  gitUrl: 'https://github.com/test/repo.git',
  branch: 'main',
  status: 'PENDING_INDEX',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function getAuthHeader(userId: string, role: string = 'developer', email: string = 'test@example.com') {
  const token = generateAccessToken({ sub: userId, email, role }, JWT_SECRET, '1h');
  return { authorization: `Bearer ${token}` };
}

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: '*' });
  await app.register(cookie);
  await app.register(authPlugin, { jwtSecret: JWT_SECRET });
  await app.register(rbacPlugin);
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString(), service: 'api' }));
  await app.register(indexRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await app.close(); });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueueIndexJob.mockResolvedValue({ id: 'job-001' });
  mocks.acquireProjectLock.mockResolvedValue(true);
  mocks.releaseProjectLock.mockResolvedValue(undefined);
  mocks.checkRateLimit.mockResolvedValue(true);
  mocks.createAuditLog.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════
// IDX TESTS (IDX-001 ~ IDX-006) — T-2026-00133
// ═══════════════════════════════════════════════════════════

describe('IDX - Index Scheduler API + BullMQ', () => {
  const TEST_INDEX = {
    id: 'idx-001', projectId: 'proj-001', type: 'FULL', status: 'QUEUED',
    triggerSource: 'MANUAL', createdAt: new Date(), error: null,
    project: { ...TEST_PROJECT, team: TEST_TEAM },
  };
  const TEST_INDEX_STATS = {
    id: 'stats-001', indexId: 'idx-001', filesScanned: 150, symbolsIndexed: 800,
    callGraphEdges: 1200, sqliteSizeBytes: 2048000, durationMs: 45000,
  };
  const TEST_INDEX_WITH_STATS = { ...TEST_INDEX, stats: TEST_INDEX_STATS, snapshots: [] };

  // IDX-001: POST Build Index
  it('IDX-001: POST /api/projects/:id/indexes/build creates IndexJob + enqueues BullMQ', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.create.mockResolvedValue(TEST_INDEX);
    mocks.prisma.project.update.mockResolvedValue({ ...TEST_PROJECT, status: 'INDEXING' });

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.status).toBe('QUEUED');
    expect(body.data.type).toBe('FULL');
    expect(body.message).toBe('Index build queued');
    expect(mocks.enqueueIndexJob).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj-001', type: 'FULL' }));
    expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'index:build_triggered' }));
  });

  // IDX-002: POST Incremental Sync
  it('IDX-002: POST /api/projects/:id/indexes/sync creates incremental sync task', async () => {
    const completedIndex = { ...TEST_INDEX, id: 'idx-completed', status: 'COMPLETED' };
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.findFirst.mockResolvedValue(completedIndex);
    mocks.prisma.index.create.mockResolvedValue({ ...TEST_INDEX, id: 'idx-002', type: 'INCREMENTAL' });

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/sync', headers: authHeader });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.type).toBe('INCREMENTAL');
    expect(body.data.status).toBe('QUEUED');
    expect(body.message).toBe('Incremental sync queued');
    expect(mocks.enqueueIndexJob).toHaveBeenCalledWith(expect.objectContaining({ type: 'INCREMENTAL' }));
  });

  it('IDX-002b: POST sync returns 400 if no completed index exists', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.findFirst.mockResolvedValue(null);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/sync', headers: authHeader });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.message).toContain('No completed index found');
  });

  // IDX-003: GET Index List
  it('IDX-003: GET /api/projects/:id/indexes returns index list', async () => {
    const mockIndexes = [
      { ...TEST_INDEX, id: 'idx-002', createdAt: new Date(Date.now() - 1000), stats: TEST_INDEX_STATS, snapshots: [] },
      { ...TEST_INDEX, id: 'idx-001', createdAt: new Date(), stats: null, snapshots: [] },
    ];
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.findMany.mockResolvedValue(mockIndexes);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'GET', url: '/api/projects/proj-001/indexes', headers: authHeader });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('idx-002');
    expect(body.data[1].id).toBe('idx-001');
  });

  // IDX-004: GET Index Status
  it('IDX-004: GET /api/indexes/:indexId/status returns status', async () => {
    mocks.prisma.index.findFirst.mockResolvedValue(TEST_INDEX_WITH_STATS);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'GET', url: '/api/indexes/idx-001/status', headers: authHeader });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.id).toBe('idx-001');
    expect(body.data.status).toBe('QUEUED');
    expect(body.data.stats.filesScanned).toBe(150);
  });

  it('IDX-004b: GET status returns 404 for non-existent index', async () => {
    mocks.prisma.index.findFirst.mockResolvedValue(null);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'GET', url: '/api/indexes/nonexistent/status', headers: authHeader });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  // IDX-005: GET Index Stats
  it('IDX-005: GET /api/indexes/:indexId/stats returns statistics', async () => {
    mocks.prisma.indexStats.findFirst.mockResolvedValue({ ...TEST_INDEX_STATS, index: { id: 'idx-001' } });

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'GET', url: '/api/indexes/idx-001/stats', headers: authHeader });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.filesScanned).toBe(150);
    expect(body.data.symbolsIndexed).toBe(800);
  });

  it('IDX-005b: GET stats returns 404 for index without stats', async () => {
    mocks.prisma.indexStats.findFirst.mockResolvedValue(null);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'GET', url: '/api/indexes/idx-nostats/stats', headers: authHeader });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  // IDX-006: Concurrency + rate limiting
  it('IDX-006: Rate-limited request returns 429', async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(false);
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.code).toBe('TOO_MANY_REQUESTS');
    expect(body.message).toBe('Rate limit exceeded for project');
  });

  it('IDX-006b: Locked project returns 429', async () => {
    mocks.acquireProjectLock.mockResolvedValueOnce(false);
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('IDX-006c: Unauthenticated request returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects/proj-001/indexes' });
    expect(res.statusCode).toBe(401);
  });

  it('IDX-006d: Build index for non-existent project returns 404', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue(null);
    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/nonexistent/indexes/build', headers: authHeader });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe('NOT_FOUND');
  });

  // IDX-007: Forbidden access (viewer role)
  it('IDX-007: Viewer role attempting build returns 403', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue({ ...TEST_MEMBER_DEV, role: 'VIEWER' });

    const authHeader = getAuthHeader('user-001', 'viewer');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  // IDX-008: Sync without prior completed index returns 400
  it('IDX-008: Sync with no prior completed index returns 400', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.findFirst.mockResolvedValue(null);

    const authHeader = getAuthHeader('user-001');
    const res = await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/sync', headers: authHeader });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.message).toContain('No completed index found');
  });

  // IDX-009: Index job priority ordering
  it('IDX-009: Enqueued full index has correct priority', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.create.mockResolvedValue(TEST_INDEX);
    mocks.prisma.project.update.mockResolvedValue({ ...TEST_PROJECT, status: 'INDEXING' });

    const authHeader = getAuthHeader('user-001');
    await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(mocks.enqueueIndexJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'FULL', priority: 0 })
    );
  });

  // IDX-010: Index trigger source tracking
  it('IDX-010: Build index sets triggerSource to MANUAL', async () => {
    mocks.prisma.project.findFirst.mockResolvedValue({ ...TEST_PROJECT, team: { ...TEST_TEAM, organization: TEST_ORG } });
    mocks.prisma.member.findFirst.mockResolvedValue(TEST_MEMBER_DEV);
    mocks.prisma.index.create.mockResolvedValue(TEST_INDEX);
    mocks.prisma.project.update.mockResolvedValue({ ...TEST_PROJECT, status: 'INDEXING' });

    const authHeader = getAuthHeader('user-001');
    await app.inject({ method: 'POST', url: '/api/projects/proj-001/indexes/build', headers: authHeader });

    expect(mocks.prisma.index.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerSource: 'MANUAL',
          type: 'FULL',
        }),
      })
    );
  });
});
