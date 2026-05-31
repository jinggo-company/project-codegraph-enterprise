// Redis-based project lock + concurrency limiter
import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Project Lock (prevents duplicate indexing of the same project) ───

const LOCK_TTL = 3600; // 1 hour max (long-running index jobs)

/**
 * Acquire a Redis lock for a project.
 * Returns true if lock acquired, false if already locked.
 */
export async function acquireProjectLock(projectId: string): Promise<boolean> {
  const lockKey = `codegraph:lock:project:${projectId}`;
  const result = await connection.set(lockKey, '1', 'EX', LOCK_TTL, 'NX');
  return result === 'OK';
}

/**
 * Release a project lock.
 */
export async function releaseProjectLock(projectId: string): Promise<void> {
  const lockKey = `codegraph:lock:project:${projectId}`;
  await connection.del(lockKey);
}

/**
 * Check if a project is currently locked.
 */
export async function isProjectLocked(projectId: string): Promise<boolean> {
  const lockKey = `codegraph:lock:project:${projectId}`;
  const val = await connection.get(lockKey);
  return val !== null;
}

// ─── Global Concurrency Limiter ──────────────────────────────────────

const MAX_CONCURRENT_INDEXES = parseInt(process.env.MAX_CONCURRENT_INDEXES ?? '5', 10);
const SEMAPHORE_KEY = 'codegraph:semaphore:index';

/**
 * Try to acquire a concurrency slot.
 * Returns true if slot acquired, false if at capacity.
 */
export async function acquireConcurrencySlot(): Promise<boolean> {
  const result = await connection.eval(
    `
    local current = redis.call('SCARD', KEYS[1])
    if current < tonumber(ARGV[1]) then
      redis.call('SADD', KEYS[1], ARGV[2])
      return 1
    end
    return 0
    `,
    1,
    SEMAPHORE_KEY,
    String(MAX_CONCURRENT_INDEXES),
    `worker:${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return result === 1;
}

/**
 * Release a concurrency slot.
 */
export async function releaseConcurrencySlot(slotId: string): Promise<void> {
  await connection.srem(SEMAPHORE_KEY, slotId);
}

/**
 * Get current concurrency usage.
 */
export async function getConcurrencyUsage(): Promise<number> {
  return connection.scard(SEMAPHORE_KEY);
}

// ─── Rate Limiter (per-project) ──────────────────────────────────────

const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = parseInt(process.env.INDEX_RATE_LIMIT ?? '10', 10); // max per window

/**
 * Check if a project has exceeded the rate limit.
 * Returns true if request is allowed, false if rate limited.
 */
export async function checkRateLimit(projectId: string): Promise<boolean> {
  const key = `codegraph:ratelimit:${projectId}`;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW * 1000;

  // Remove old entries
  await connection.zremrangebyscore(key, 0, windowStart);

  // Count current entries
  const count = await connection.zcard(key);
  if (count >= RATE_LIMIT_MAX) {
    return false;
  }

  // Add current request
  await connection.zadd(key, String(now), `${now}-${Math.random()}`);

  // Set expiry on the key
  await connection.expire(key, RATE_LIMIT_WINDOW);

  return true;
}

export { connection };
