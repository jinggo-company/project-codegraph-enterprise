/**
 * F4 MCP Server Gateway Hosting Tests — T-2026-00266
 *
 * Covers: IndexEnginePool, SessionManager, HTTP server routes
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── F4-004, F4-010: IndexEnginePool ───

describe('F4: IndexEnginePool', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/f4-pool-');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('F4-004: acquire returns same engine for same project', async () => {
    const { IndexEnginePool } = await import('../src/index-engine/pool');
    const pool = new IndexEnginePool(testDir);

    // Create a dummy index file
    fs.mkdirSync(path.join(testDir, 'proj-a'), { recursive: true });

    // hasIndex should return false since no real SQLite file
    // but acquire should still create an engine
    const engine1 = pool.acquire('proj-a');
    const engine2 = pool.acquire('proj-a');

    expect(engine1).toBe(engine2); // same instance (shared)
    expect(pool.getRefCount('proj-a')).toBe(2);

    pool.release('proj-a');
    expect(pool.getRefCount('proj-a')).toBe(1);

    pool.release('proj-a');
    expect(pool.getRefCount('proj-a')).toBe(0);

    pool.shutdown();
  });

  it('F4-010: different projects get different engines', async () => {
    const { IndexEnginePool } = await import('../src/index-engine/pool');
    const pool = new IndexEnginePool(testDir);

    fs.mkdirSync(path.join(testDir, 'proj-a'), { recursive: true });
    fs.mkdirSync(path.join(testDir, 'proj-b'), { recursive: true });

    const engineA = pool.acquire('proj-a');
    const engineB = pool.acquire('proj-b');

    expect(engineA).not.toBe(engineB);
    expect(pool.size).toBe(2);

    pool.shutdown();
  });

  it('F4-005: cleanup removes idle entries', async () => {
    const { IndexEnginePool } = await import('../src/index-engine/pool');
    const pool = new IndexEnginePool(testDir, 100); // 100ms TTL

    fs.mkdirSync(path.join(testDir, 'proj-idle'), { recursive: true });
    pool.acquire('proj-idle');
    pool.release('proj-idle');

    expect(pool.size).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    pool.cleanup();
    expect(pool.size).toBe(0);
  });

  it('F4-011: shutdown closes all engines', async () => {
    const { IndexEnginePool } = await import('../src/index-engine/pool');
    const pool = new IndexEnginePool(testDir);

    fs.mkdirSync(path.join(testDir, 'proj-x'), { recursive: true });
    pool.acquire('proj-x');
    pool.acquire('proj-x');

    pool.shutdown();
    expect(pool.size).toBe(0);
  });
});

// ─── F4-004, F4-005, F4-006, F4-012: SessionManager ───

describe('F4: SessionManager', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/f4-session-');
  });

  afterEach(() => {
    // cleanup
  });

  it('F4-004: create returns a session with a unique ID', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
    });

    const { sessionId, session } = mgr.create('key-1', 'proj-a');

    expect(sessionId).toBeDefined();
    expect(session.sessionId).toBe(sessionId);
    expect(session.apiKey).toBe('key-1');
    expect(session.projectId).toBe('proj-a');
    expect(session.server).toBeDefined();

    mgr.shutdown();
  });

  it('F4-004: two agents on same project share one IndexEngine', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
    });

    const { sessionId: id1 } = mgr.create('key-1', 'proj-a');
    const { sessionId: id2 } = mgr.create('key-1', 'proj-a');

    expect(id1).not.toBe(id2); // different sessions
    expect(mgr.getPoolRefCount('proj-a')).toBe(2); // same pool entry, refCount=2

    mgr.close(id1);
    expect(mgr.getPoolRefCount('proj-a')).toBe(1);

    mgr.close(id2);
    expect(mgr.getPoolRefCount('proj-a')).toBe(0);

    mgr.shutdown();
  });

  it('F4-006: maxSessions enforced with LRU eviction', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
      maxSessions: 3,
    });

    const r1 = mgr.create('k1', 'p1');
    const r2 = mgr.create('k2', 'p2');
    const r3 = mgr.create('k3', 'p3');

    expect(mgr.sessionCount).toBe(3);

    // Creating a 4th should evict the oldest (r1)
    const r4 = mgr.create('k4', 'p4');
    expect(mgr.sessionCount).toBe(3);
    expect(mgr.get(r1.sessionId)).toBeUndefined(); // evicted
    expect(mgr.get(r4.sessionId)).toBeDefined(); // new one exists

    mgr.shutdown();
  });

  it('F4-012: LRU evicts least recently accessed', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
      maxSessions: 2,
    });

    const r1 = mgr.create('k1', 'p1');
    await new Promise((r) => setTimeout(r, 20)); // ensure distinct timestamps
    const r2 = mgr.create('k2', 'p2');

    // Touch r1 so it becomes more recently accessed than r2
    await new Promise((r) => setTimeout(r, 20));
    mgr.get(r1.sessionId);

    // Create r3, should evict r2 (older lastAccess)
    const r3 = mgr.create('k3', 'p3');

    expect(mgr.get(r1.sessionId)).toBeDefined(); // still alive (touched)
    expect(mgr.get(r2.sessionId)).toBeUndefined(); // evicted
    expect(mgr.get(r3.sessionId)).toBeDefined();

    mgr.shutdown();
  });

  it('F4-005: cleanup removes expired sessions', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
      ttlMs: 100, // 100ms TTL
    });

    mgr.create('k1', 'p1');
    mgr.create('k2', 'p2');

    expect(mgr.sessionCount).toBe(2);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 150));

    mgr.cleanup();
    expect(mgr.sessionCount).toBe(0);

    mgr.shutdown();
  });

  it('F4-005: active sessions survive cleanup', async () => {
    const { SessionManager } = await import('../src/session/manager');
    const mgr = new SessionManager({
      indexDir: testDir,
      apiKey: 'test-key',
      ttlMs: 500, // 500ms TTL
    });

    mgr.create('k1', 'p1');

    // Wait less than TTL
    await new Promise((r) => setTimeout(r, 100));

    mgr.cleanup();
    expect(mgr.sessionCount).toBe(1); // still alive

    mgr.shutdown();
  });
});

// ─── F4-007: HTTP Health Check ───

describe('F4: HTTP Server Health Check', () => {
  it('F4-007: McpHttpServer class exists', async () => {
    // Dynamically import — if fastify is installed, the class loads
    const httpModule = await import('../src/http-server');
    expect(typeof httpModule.McpHttpServer).toBe('function');
    expect(typeof httpModule.startHttpServerIfEnabled).toBe('function');
  });

  it('F4-007: startHttpServerIfEnabled returns null when httpPort=0', async () => {
    // Save original env
    const origPort = process.env.MCP_HTTP_PORT;
    delete process.env.MCP_HTTP_PORT;

    try {
      vi.resetModules();
      const { startHttpServerIfEnabled } = await import('../src/http-server');
      const result = await startHttpServerIfEnabled();
      expect(result).toBeNull();
    } finally {
      // Restore
      if (origPort !== undefined) process.env.MCP_HTTP_PORT = origPort;
    }
  });
});

// ─── F4-009: Multi-agent concurrent access (pool safety) ───

describe('F4-009: Concurrent pool access', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync('/tmp/f4-concurrent-');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('F4-009: rapid acquire/release is safe', async () => {
    const { IndexEnginePool } = await import('../src/index-engine/pool');
    const pool = new IndexEnginePool(testDir);

    fs.mkdirSync(path.join(testDir, 'proj-c'), { recursive: true });

    const engines: any[] = [];
    for (let i = 0; i < 10; i++) {
      engines.push(pool.acquire('proj-c'));
    }

    expect(pool.getRefCount('proj-c')).toBe(10);
    // All should be the same instance
    for (const e of engines) {
      expect(e).toBe(engines[0]);
    }

    for (const _ of engines) {
      pool.release('proj-c');
    }
    expect(pool.getRefCount('proj-c')).toBe(0);

    pool.shutdown();
  });
});
