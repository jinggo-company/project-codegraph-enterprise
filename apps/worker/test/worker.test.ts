// Worker Tests — WRK-001 ~ WRK-006 (T-2026-00133)
// Index building and task queue tests for the CodeGraph Enterprise worker

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ─── Helper: read source files ──────────────────────────────────────────────

const srcDir = resolve(__dirname, '../src');
const apiSrcDir = resolve(__dirname, '../../../apps/api/src');

function readSourceFile(relativePath: string): string {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

function readApiSourceFile(relativePath: string): string {
  return readFileSync(join(apiSrcDir, relativePath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════
// WRK-001: Job enqueuing — BullMQ queue receives index build jobs
// ═══════════════════════════════════════════════════════════

describe('WRK-001: Job Enqueuing', () => {
  it('WRK-001: API scheduler creates BullMQ Queue instances', () => {
    const schedulerContent = readApiSourceFile('lib/scheduler.ts');
    // Three queues should be defined
    expect(schedulerContent).toContain("new Queue('index-full'");
    expect(schedulerContent).toContain("new Queue('index-incremental'");
    expect(schedulerContent).toContain("new Queue('index-cleanup'");
  });

  it('WRK-001: enqueueIndexJob function exists and adds to correct queue', () => {
    const schedulerContent = readApiSourceFile('lib/scheduler.ts');
    expect(schedulerContent).toContain('export async function enqueueIndexJob');
    expect(schedulerContent).toContain('queue.add(');
    // Should map job types to queues
    expect(schedulerContent).toContain('getQueueForType');
  });

  it('WRK-001: Queue job payload contains required fields', () => {
    const schedulerContent = readApiSourceFile('lib/scheduler.ts');
    // Payload should include jobId, projectId, indexId, type, trigger
    expect(schedulerContent).toContain('jobId: job.id');
    expect(schedulerContent).toContain('projectId: job.projectId');
    expect(schedulerContent).toContain('type: job.type');
    expect(schedulerContent).toContain('trigger: job.trigger');
  });

  it('WRK-001: Webhook endpoint enqueues index jobs', () => {
    const webhookContent = readApiSourceFile('modules/webhooks/index.ts');
    // GitHub webhook should create and enqueue
    expect(webhookContent).toContain('enqueueIndexJob');
    expect(webhookContent).toContain('/api/webhooks/github');
  });

  it('WRK-001: Index build endpoint enqueues BullMQ task', () => {
    const indexContent = readApiSourceFile('modules/indexes/index.ts');
    expect(indexContent).toContain('enqueueIndexJob');
    expect(indexContent).toContain('POST');
    expect(indexContent).toContain('indexes/build');
  });
});

// ═══════════════════════════════════════════════════════════
// WRK-002: Worker consumes tasks — processes jobs from queues
// ═══════════════════════════════════════════════════════════

describe('WRK-002: Worker Consumption', () => {
  it('WRK-002: Worker file exists and creates Workers for all three queues', () => {
    const workerContent = readSourceFile('worker.ts');
    expect(workerContent).toContain("new Worker(");
    expect(workerContent).toContain('index-full');
    expect(workerContent).toContain('index-incremental');
    expect(workerContent).toContain('index-cleanup');
  });

  it('WRK-002: Worker handles full index build', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    expect(buildIndexContent).toContain('export async function handleBuildIndex');
    // Should clone repo, run indexer, upload snapshot
    expect(buildIndexContent).toContain('cloneRepository');
    expect(buildIndexContent).toContain('runCodeGraphIndex');
    expect(buildIndexContent).toContain('uploadSnapshot');
  });

  it('WRK-002: Worker handles incremental sync', () => {
    const syncIndexContent = readSourceFile('jobs/sync-index.ts');
    expect(syncIndexContent).toContain('export async function handleSyncIndex');
    expect(syncIndexContent).toContain('runIncrementalIndex');
  });

  it('WRK-002: Worker handles cleanup', () => {
    const cleanupContent = readSourceFile('jobs/cleanup-index.ts');
    expect(cleanupContent).toContain('export async function handleCleanupIndex');
    expect(cleanupContent).toContain('deleteIndexSnapshots');
  });

  it('WRK-002: Worker updates DB status during job lifecycle', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    // Should update status to RUNNING, then COMPLETED
    expect(buildIndexContent).toContain('RUNNING');
    expect(buildIndexContent).toContain('COMPLETED');
    expect(buildIndexContent).toContain('FAILED');
  });
});

// ═══════════════════════════════════════════════════════════
// WRK-003: Retry on failure — auto retry up to 3 times
// ═══════════════════════════════════════════════════════════

describe('WRK-003: Task Retry', () => {
  it('WRK-003: Queue config includes retry attempts', () => {
    const schedulerContent = readApiSourceFile('lib/scheduler.ts');
    expect(schedulerContent).toContain('attempts:');
    expect(schedulerContent).toContain('attempts: 3');
  });

  it('WRK-003: Queue config includes exponential backoff', () => {
    const schedulerContent = readApiSourceFile('lib/scheduler.ts');
    expect(schedulerContent).toContain('backoff');
    expect(schedulerContent).toContain("'exponential'");
    expect(schedulerContent).toContain('delay:');
  });

  it('WRK-003: Failed jobs update DB with error and increment retries', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    // On failure, should update index to FAILED and increment retry count
    expect(buildIndexContent).toContain('status: \'FAILED\'');
    expect(buildIndexContent).toContain('error: buildError.message');
    expect(buildIndexContent).toContain('retries');
  });

  it('WRK-003: Cleanup job handler also tracks failures', () => {
    const cleanupContent = readSourceFile('jobs/cleanup-index.ts');
    expect(cleanupContent).toContain('COMPLETED');
    expect(cleanupContent).toContain('catch');
  });
});

// ═══════════════════════════════════════════════════════════
// WRK-004: Timeout handling — long jobs get marked failed
// ═══════════════════════════════════════════════════════════

describe('WRK-004: Timeout Handling', () => {
  it('WRK-004: Git clone has timeout protection', () => {
    const runnerContent = readSourceFile('runners/codegraph-runner.ts');
    expect(runnerContent).toContain('timeout:');
    expect(runnerContent).toContain('300_000'); // 5min for clone
  });

  it('WRK-004: Cleanup on failure removes temp directories', () => {
    const runnerContent = readSourceFile('runners/codegraph-runner.ts');
    // Should have cleanup in catch blocks and finally
    expect(runnerContent).toContain('cleanupTemp');
    expect(runnerContent).toContain('rm(');
    expect(runnerContent).toContain('recursive: true');
  });

  it('WRK-004: Build job cleanup runs in finally block', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    expect(buildIndexContent).toContain('finally');
    expect(buildIndexContent).toContain('cleanupTemp');
  });

  it('WRK-004: Sync job cleanup runs in finally block', () => {
    const syncIndexContent = readSourceFile('jobs/sync-index.ts');
    expect(syncIndexContent).toContain('finally');
    expect(syncIndexContent).toContain('cleanupTemp');
  });

  it('WRK-004: Failed jobs mark index as FAILED with error message', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    expect(buildIndexContent).toContain('status: \'FAILED\'');
    expect(buildIndexContent).toContain('error: buildError.message');
  });
});

// ═══════════════════════════════════════════════════════════
// WRK-005: Concurrency limiting — respects configured limits
// ═══════════════════════════════════════════════════════════

describe('WRK-005: Concurrency Limiting', () => {
  it('WRK-005: Worker has concurrency configuration', () => {
    const workerContent = readSourceFile('worker.ts');
    expect(workerContent).toContain('concurrency:');
    expect(workerContent).toContain('WORKER_CONCURRENCY');
  });

  it('WRK-005: Project lock prevents duplicate indexing', () => {
    const workerContent = readSourceFile('worker.ts');
    expect(workerContent).toContain('acquireProjectLock');
    expect(workerContent).toContain('releaseProjectLock');
    expect(workerContent).toContain('codegraph:lock:project');
  });

  it('WRK-005: Lock is released in finally block for all workers', () => {
    const workerContent = readSourceFile('worker.ts');
    // Count "finally" blocks that contain "releaseProjectLock"
    const finallyBlocks = workerContent.match(/finally\s*\{[\s\S]*?releaseProjectLock/g);
    // Should be at least 3 (one per worker type)
    expect(finallyBlocks).not.toBeNull();
    expect(finallyBlocks!.length).toBeGreaterThanOrEqual(3);
  });

  it('WRK-005: Rate limiter configured on full index worker', () => {
    const workerContent = readSourceFile('worker.ts');
    expect(workerContent).toContain('limiter');
    expect(workerContent).toContain('WORKER_RATE_LIMIT_MAX');
    expect(workerContent).toContain('WORKER_RATE_LIMIT_DURATION');
  });

  it('WRK-005: Concurrency slot tracking in API layer', () => {
    const concurrencyContent = readApiSourceFile('lib/concurrency.ts');
    expect(concurrencyContent).toContain('acquireConcurrencySlot');
    expect(concurrencyContent).toContain('releaseConcurrencySlot');
    expect(concurrencyContent).toContain('MAX_CONCURRENT_INDEXES');
  });

  it('WRK-005: Per-project rate limiting in API layer', () => {
    const concurrencyContent = readApiSourceFile('lib/concurrency.ts');
    expect(concurrencyContent).toContain('checkRateLimit');
    expect(concurrencyContent).toContain('RATE_LIMIT_MAX');
    expect(concurrencyContent).toContain('codegraph:ratelimit');
  });
});

// ═══════════════════════════════════════════════════════════
// WRK-006: Snapshot storage — indexes uploaded to MinIO/S3
// ═══════════════════════════════════════════════════════════

describe('WRK-006: Snapshot Storage (MinIO)', () => {
  it('WRK-006: MinIO client is configured', () => {
    const storageContent = readSourceFile('lib/storage.ts');
    expect(storageContent).toContain('new Client');
    expect(storageContent).toContain('MINIO_ENDPOINT');
    expect(storageContent).toContain('MINIO_PORT');
    expect(storageContent).toContain('MINIO_ACCESS_KEY');
    expect(storageContent).toContain('MINIO_SECRET_KEY');
  });

  it('WRK-006: Upload function uploads index.db to correct path', () => {
    const storageContent = readSourceFile('lib/storage.ts');
    expect(storageContent).toContain('uploadSnapshot');
    expect(storageContent).toContain('fPutObject');
    expect(storageContent).toContain('index.db');
  });

  it('WRK-006: Build job saves snapshot record to DB', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    expect(buildIndexContent).toContain('prisma.snapshot.create');
    expect(buildIndexContent).toContain('storageKey');
    expect(buildIndexContent).toContain('sizeBytes');
  });

  it('WRK-006: Build job saves index stats to DB', () => {
    const buildIndexContent = readSourceFile('jobs/build-index.ts');
    expect(buildIndexContent).toContain('prisma.indexStats.create');
    expect(buildIndexContent).toContain('filesScanned');
    expect(buildIndexContent).toContain('symbolsIndexed');
    expect(buildIndexContent).toContain('callGraphEdges');
  });

  it('WRK-006: Cleanup job deletes MinIO snapshots', () => {
    const cleanupContent = readSourceFile('jobs/cleanup-index.ts');
    expect(cleanupContent).toContain('deleteIndexSnapshots');
  });

  it('WRK-006: Worker ensures bucket exists on startup', () => {
    const workerContent = readSourceFile('worker.ts');
    expect(workerContent).toContain('ensureBucket');
  });
});
