// Concurrency control — project-level locks + rate limiting
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

const LOCK_PREFIX = 'lock:project:';
const LOCK_TTL = 3600; // 1 hour max lock (index build should not exceed this)
const RATE_WINDOW = 60; // 1-minute window
const RATE_MAX = 10; // max index builds per project per minute

/**
 * Acquire a project-level lock. Returns true if acquired, false if already locked.
 */
export async function acquireProjectLock(projectId: string): Promise<boolean> {
  const key = `${LOCK_PREFIX}${projectId}`;
  const result = await redis.set(key, '1', 'EX', LOCK_TTL, 'NX');
  return result === 'OK';
}

/**
 * Release a project-level lock.
 */
export async function releaseProjectLock(projectId: string): Promise<void> {
  const key = `${LOCK_PREFIX}${projectId}`;
  await redis.del(key);
}

/**
 * Check if a project is currently locked (another index build is running).
 */
export async function isProjectLocked(projectId: string): Promise<boolean> {
  const key = `${LOCK_PREFIX}${projectId}`;
  const val = await redis.get(key);
  return val !== null;
}

/**
 * Rate-limit check for a project.
 * Returns true if the request is within limits.
 */
export async function checkRateLimit(projectId: string): Promise<boolean> {
  const key = `rate:project:${projectId}`;
  const now = Date.now();
  const windowStart = now - RATE_WINDOW * 1000;

  // Remove entries older than window
  await redis.zremrangebyscore(key, 0, windowStart);

  // Count current entries
  const count = await redis.zcard(key);
  if (count >= RATE_MAX) {
    return false;
  }

  // Add current entry
  await redis.zadd(key, now, `${now}-${Math.random()}`);
  // Set expiry on the key
  await redis.expire(key, RATE_WINDOW);

  return true;
}

/**
 * Try to acquire lock + check rate limit. Returns result.
 */
export async function tryAcquireForIndex(projectId: string): Promise<{
  allowed: boolean;
  reason?: string;
}> {
  const locked = await isProjectLocked(projectId);
  if (locked) {
    return { allowed: false, reason: 'Project currently indexing' };
  }

  const withinRate = await checkRateLimit(projectId);
  if (!withinRate) {
    return { allowed: false, reason: 'Rate limit exceeded for project' };
  }

  const lockAcquired = await acquireProjectLock(projectId);
  if (!lockAcquired) {
    return { allowed: false, reason: 'Project currently indexing (race)' };
  }

  return { allowed: true };
}

/**
 * Get current queue count for a project (across all queues).
 */
export async function getActiveJobCountForProject(queues: { getJobCounts: () => Promise<any> }[]): Promise<number> {
  let total = 0;
  for (const q of queues) {
    const counts = await q.getJobCounts();
    total += counts.active ?? 0;
  }
  return total;
}

export { redis };
