// BullMQ Worker — CodeGraph Enterprise index pipeline
// Consumes jobs from three queues: index-full, index-incremental, index-cleanup
import { Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { handleBuildIndex, type BuildIndexJobData } from './jobs/build-index.js';
import { handleSyncIndex, type SyncIndexJobData } from './jobs/sync-index.js';
import { handleCleanupIndex, type CleanupIndexJobData } from './jobs/cleanup-index.js';
import { ensureBucket } from './lib/storage.js';

// ─── Redis Connection ──────────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection: ConnectionOptions = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Concurrency Config ────────────────────────────────────────────────

const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);

// ─── Project Lock Helper ───────────────────────────────────────────────

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function acquireProjectLock(projectId: string): Promise<boolean> {
  const lockKey = `codegraph:lock:project:${projectId}`;
  const result = await redis.set(lockKey, '1', 'EX', 3600, 'NX');
  return result === 'OK';
}

async function releaseProjectLock(projectId: string): Promise<void> {
  const lockKey = `codegraph:lock:project:${projectId}`;
  await redis.del(lockKey);
}

// ─── Worker: index-full ────────────────────────────────────────────────

const fullIndexWorker = new Worker(
  'index-full',
  async (job) => {
    const data = job.data as BuildIndexJobData;
    console.log(`[worker] Processing full index job ${job.id} for project ${data.projectId}`);

    // Acquire project lock
    const locked = await acquireProjectLock(data.projectId);
    if (!locked) {
      throw new Error(`Project ${data.projectId} is already being indexed`);
    }

    try {
      return await handleBuildIndex(job);
    } finally {
      await releaseProjectLock(data.projectId);
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
    limiter: {
      max: parseInt(process.env.WORKER_RATE_LIMIT_MAX ?? '10', 10),
      duration: parseInt(process.env.WORKER_RATE_LIMIT_DURATION ?? '60000', 10),
    },
  },
);

// ─── Worker: index-incremental ─────────────────────────────────────────

const incrementalIndexWorker = new Worker(
  'index-incremental',
  async (job) => {
    const data = job.data as SyncIndexJobData;
    console.log(`[worker] Processing incremental index job ${job.id} for project ${data.projectId}`);

    const locked = await acquireProjectLock(data.projectId);
    if (!locked) {
      throw new Error(`Project ${data.projectId} is already being indexed`);
    }

    try {
      return await handleSyncIndex(job);
    } finally {
      await releaseProjectLock(data.projectId);
    }
  },
  {
    connection,
    concurrency: CONCURRENCY,
  },
);

// ─── Worker: index-cleanup ─────────────────────────────────────────────

const cleanupIndexWorker = new Worker(
  'index-cleanup',
  async (job) => {
    const data = job.data as CleanupIndexJobData;
    console.log(`[worker] Processing cleanup job ${job.id} for project ${data.projectId}`);

    const locked = await acquireProjectLock(data.projectId);
    if (!locked) {
      throw new Error(`Project ${data.projectId} is already being indexed`);
    }

    try {
      return await handleCleanupIndex(job);
    } finally {
      await releaseProjectLock(data.projectId);
    }
  },
  {
    connection,
    concurrency: 1, // Cleanup is low-priority, run one at a time
  },
);

// ─── Event Handlers ────────────────────────────────────────────────────

fullIndexWorker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} (index-full) completed`);
});

fullIndexWorker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} (index-full) failed: ${err.message}`);
});

incrementalIndexWorker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} (index-incremental) completed`);
});

incrementalIndexWorker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} (index-incremental) failed: ${err.message}`);
});

cleanupIndexWorker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} (index-cleanup) completed`);
});

cleanupIndexWorker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} (index-cleanup) failed: ${err.message}`);
});

// ─── Startup ───────────────────────────────────────────────────────────

async function main() {
  console.log('CodeGraph Worker starting...');

  // Ensure MinIO bucket exists
  try {
    await ensureBucket();
    console.log('MinIO bucket ready');
  } catch (err: any) {
    console.warn(`MinIO bucket check failed (will retry on first upload): ${err.message}`);
  }

  console.log(`Worker started — concurrency: ${CONCURRENCY}`);
  console.log(`  Queues: index-full, index-incremental, index-cleanup`);
}

// ─── Graceful Shutdown ─────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('Shutting down workers...');
  await Promise.all([
    fullIndexWorker.close(),
    incrementalIndexWorker.close(),
    cleanupIndexWorker.close(),
  ]);
  await redis.quit();
  await (connection as Redis).quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Interrupted, shutting down...');
  await Promise.all([
    fullIndexWorker.close(),
    incrementalIndexWorker.close(),
    cleanupIndexWorker.close(),
  ]);
  await redis.quit();
  await (connection as Redis).quit();
  process.exit(0);
});

// Export workers for testing
export { fullIndexWorker, incrementalIndexWorker, cleanupIndexWorker, connection, redis };

// Start
main().catch((err) => {
  console.error('Worker startup failed:', err);
  process.exit(1);
});
