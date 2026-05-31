// Index job scheduler — BullMQ queue management
import { Queue, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';

const redisConnection: ConnectionOptions = new Redis(
  process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null }
);

// Named queues
export const buildQueue = new Queue('build-index', { connection: redisConnection });
export const syncQueue = new Queue('sync-index', { connection: redisConnection });
export const cleanupQueue = new Queue('cleanup-index', { connection: redisConnection });

export interface EnqueueIndexJobParams {
  projectId: string;
  type: 'full' | 'incremental' | 'cleanup';
  triggerSource: 'webhook' | 'manual' | 'watcher' | 'schedule';
  gitUrl: string;
  branch: string;
  /** Optional: list of changed files (for incremental) */
  changedFiles?: string[];
  /** Previous index ID for incremental merge */
  previousIndexId?: string;
}

export async function enqueueIndexJob(params: EnqueueIndexJobParams): Promise<string> {
  const jobId = `idx-${params.type}-${params.projectId}-${Date.now()}`;

  switch (params.type) {
    case 'full':
      await buildQueue.add('build', {
        projectId: params.projectId,
        gitUrl: params.gitUrl,
        branch: params.branch,
        triggerSource: params.triggerSource,
        changedFiles: undefined,
        previousIndexId: undefined,
      }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      break;
    case 'incremental':
      await syncQueue.add('sync', {
        projectId: params.projectId,
        gitUrl: params.gitUrl,
        branch: params.branch,
        triggerSource: params.triggerSource,
        changedFiles: params.changedFiles ?? [],
        previousIndexId: params.previousIndexId,
      }, { jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
      break;
    case 'cleanup':
      await cleanupQueue.add('cleanup', {
        projectId: params.projectId,
        previousIndexId: params.previousIndexId,
      }, { jobId, attempts: 1 });
      break;
  }

  return jobId;
}

export async function getQueueStatus(projectId: string) {
  const [buildCount, syncCount, cleanupCount] = await Promise.all([
    buildQueue.getJobCounts(),
    syncQueue.getJobCounts(),
    cleanupQueue.getJobCounts(),
  ]);

  return {
    build: buildCount,
    sync: syncCount,
    cleanup: cleanupCount,
  };
}
