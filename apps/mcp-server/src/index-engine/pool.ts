/**
 * IndexEnginePool — shared, per-project IndexEngine cache.
 *
 * Enables multi-agent session reuse: multiple MCP sessions targeting
 * the same project share a single IndexEngine instance (read-only SQLite).
 *
 * Thread-safety: Node.js is single-threaded; the pool is a plain Map
 * guarded by reference counting.
 */

import type { IndexEngine } from './engine.js';
import { LocalSqliteEngine } from './local.js';

interface PoolEntry {
  engine: IndexEngine;
  lastAccess: number;
  refCount: number;
}

export class IndexEnginePool {
  private pool = new Map<string, PoolEntry>();

  constructor(
    private indexDir: string,
    private idleTtlMs: number = 30 * 60 * 1000, // 30 min
  ) {}

  /** Get (or create) a shared IndexEngine for the given project. */
  acquire(projectId: string): IndexEngine {
    const existing = this.pool.get(projectId);
    if (existing) {
      existing.refCount++;
      existing.lastAccess = Date.now();
      return existing.engine;
    }

    const engine = new LocalSqliteEngine(this.indexDir);
    // Pre-open so the engine is ready
    // Note: open() is async in LocalSqliteEngine, but hasIndex() is sync.
    // The caller is responsible for ensuring the index exists before calling acquire().
    this.pool.set(projectId, {
      engine,
      lastAccess: Date.now(),
      refCount: 1,
    });
    return engine;
  }

  /** Release a previously acquired engine. If refCount drops to 0, it becomes idle. */
  release(projectId: string): void {
    const entry = this.pool.get(projectId);
    if (!entry) return;
    entry.refCount--;
    entry.lastAccess = Date.now();
  }

  /** Remove all idle entries (refCount === 0) older than maxAgeMs. */
  cleanup(maxAgeMs?: number): void {
    const threshold = maxAgeMs ?? this.idleTtlMs;
    const now = Date.now();
    for (const [projectId, entry] of this.pool.entries()) {
      if (entry.refCount <= 0 && now - entry.lastAccess > threshold) {
        entry.engine.close();
        this.pool.delete(projectId);
      }
    }
  }

  /** Close and clear the entire pool (e.g. on shutdown). */
  shutdown(): void {
    for (const [, entry] of this.pool.entries()) {
      entry.engine.close();
    }
    this.pool.clear();
  }

  /** For testing — return current pool size. */
  get size(): number {
    return this.pool.size;
  }

  /** For testing — return ref count for a project. */
  getRefCount(projectId: string): number {
    return this.pool.get(projectId)?.refCount ?? 0;
  }
}
