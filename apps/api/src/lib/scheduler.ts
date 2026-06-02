// BullMQ scheduler for CodeGraph Enterprise index pipeline
// Three queues: index-full (high priority), index-incremental (medium), index-cleanup (low)
import { Queue, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Three Queues ─────────────────────────────────────────────────────
// Queue names must match apps/worker/src/worker.ts

export const fullIndexQueue = new Queue('index-full', { connection });

export const incrementalIndexQueue = new Queue('index-incremental', { connection });

export const cleanupQueue = new Queue('index-cleanup', { connection });

// ─── Queue Events for monitoring ──────────────────────────────────────

export const fullIndexQueueEvents = new QueueEvents('index-full', { connection });

export const incrementalIndexQueueEvents = new QueueEvents('index-incremental', { connection });

// ─── Queue Config ─────────────────────────────────────────────────────

interface QueueConfig {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number; count: number };
}

const defaultConfig: QueueConfig = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30000 }, // 30s, 60s, 120s
  removeOnComplete: { age: 86400, count: 1000 }, // keep 24h or 1000 jobs
  removeOnFail: { age: 604800, count: 500 }, // keep 7d or 500 jobs
};

// ─── Enqueue ──────────────────────────────────────────────────────────

export interface IndexJobPayload {
  id: string;
  projectId: string;
  indexId: string | null;
  type: string;
  trigger: string;
  priority: number;
}

export async function enqueueIndexJob(job: IndexJobPayload): Promise<Job> {
  const queue = getQueueForType(job.type);
  return queue.add(
    `index-${job.type.toLowerCase()}`,
    {
      jobId: job.id,
      projectId: job.projectId,
      indexId: job.indexId,
      type: job.type,
      trigger: job.trigger,
    },
    {
      ...defaultConfig,
      priority: job.priority,
      jobId: job.id, // deduplication
      removeOnComplete: { ...defaultConfig.removeOnComplete },
      removeOnFail: { ...defaultConfig.removeOnFail },
    },
  );
}

// ─── Cancel / Retry ───────────────────────────────────────────────────

export async function cancelJob(jobId: string): Promise<boolean> {
  const queues = [fullIndexQueue, incrementalIndexQueue, cleanupQueue];
  for (const queue of queues) {
    const job = await queue.getJob(jobId);
    if (job) {
      try {
        await job.moveToFailed(new Error('Cancelled by user'), 'api');
        return true;
      } catch {
        await job.remove();
        return true;
      }
    }
  }
  return false;
}

export async function getJobStatus(jobId: string): Promise<{
  status: string;
  job?: Job | null;
} | null> {
  const queues = [fullIndexQueue, incrementalIndexQueue, cleanupQueue];
  for (const queue of queues) {
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      return { status: state, job };
    }
  }
  return null;
}

// ─── Queue Stats ──────────────────────────────────────────────────────

export async function getQueueStats(): Promise<Record<string, Record<string, number>>> {
  const stats: Record<string, Record<string, number>> = {};

  const queueMap: Record<string, typeof fullIndexQueue> = {
    'index-full': fullIndexQueue,
    'index-incremental': incrementalIndexQueue,
    'index-cleanup': cleanupQueue,
  };

  for (const [name, queue] of Object.entries(queueMap)) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    stats[name] = { waiting, active, completed, failed, delayed };
  }

  return stats;
}

// ─── Helper ───────────────────────────────────────────────────────────

export function getQueueForType(type: string): typeof fullIndexQueue {
  switch (type) {
    case 'INCREMENTAL':
      return incrementalIndexQueue;
    case 'CLEANUP':
      return cleanupQueue;
    default:
      return fullIndexQueue;
  }
}

// Re-export connection for tests
export { connection };
