/**
 * SessionManager — manages MCP sessions for multi-agent session reuse.
 *
 * - Each agent (Claude Code, Cursor, Codex) gets its own McpServer instance.
 * - Sessions sharing the same API key + project share one IndexEngine via the pool.
 * - Idle sessions are cleaned up after TTL.
 * - LRU eviction when maxSessions is reached.
 */

import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpSession } from './types.js';
import type { IndexEngine } from '../index-engine/engine.js';
import { IndexEnginePool } from '../index-engine/pool.js';
import {
  registerSearchCode,
  registerGetSymbol,
  registerGetCallers,
  registerGetCallees,
  registerGetImpact,
  registerSearchRoutes,
  registerSearchFulltext,
} from '../tools/index.js';

export interface SessionManagerOptions {
  /** Maximum concurrent sessions */
  maxSessions?: number;
  /** Session idle TTL in ms (default 30 min) */
  ttlMs?: number;
  /** Index directory */
  indexDir: string;
  /** Global API key for auth (empty = dev mode) */
  apiKey: string;
  /** Server name */
  serverName?: string;
  /** Server version */
  serverVersion?: string;
}

export class SessionManager {
  private sessions = new Map<string, McpSession>();
  private pool: IndexEnginePool;
  private readonly maxSessions: number;
  private readonly ttlMs: number;
  private readonly apiKey: string;
  private readonly serverName: string;
  private readonly serverVersion: string;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SessionManagerOptions) {
    this.maxSessions = options.maxSessions ?? 100;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.apiKey = options.apiKey;
    this.serverName = options.serverName ?? 'codegraph-enterprise';
    this.serverVersion = options.serverVersion ?? '0.1.0';
    this.pool = new IndexEnginePool(options.indexDir, this.ttlMs);
  }

  /** Create a new MCP session for an agent. */
  create(apiKey: string, projectId: string): { session: McpSession; sessionId: string } {
    // Enforce max sessions (with LRU eviction)
    if (this.sessions.size >= this.maxSessions) {
      this.evictLru();
    }

    const sessionId = crypto.randomUUID();
    const engine = this.pool.acquire(projectId);

    const server = new McpServer({
      name: this.serverName,
      version: this.serverVersion,
    });

    // Register all 7 tools against the shared engine
    registerSearchCode(server, engine, this.apiKey);
    registerGetSymbol(server, engine, this.apiKey);
    registerGetCallers(server, engine, this.apiKey);
    registerGetCallees(server, engine, this.apiKey);
    registerGetImpact(server, engine, this.apiKey);
    registerSearchRoutes(server, engine, this.apiKey);
    registerSearchFulltext(server, engine, this.apiKey);

    const now = Date.now();
    const session: McpSession = {
      sessionId,
      apiKey,
      projectId,
      server,
      createdAt: now,
      lastAccess: now,
    };

    this.sessions.set(sessionId, session);
    return { session, sessionId };
  }

  /** Get an existing session by ID. */
  get(sessionId: string): McpSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccess = Date.now();
    }
    return session;
  }

  /** Close and remove a session. */
  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.pool.release(session.projectId);
    this.sessions.delete(sessionId);
  }

  /** Run periodic cleanup of idle sessions. */
  startCleanup(intervalMs: number = 5 * 60 * 1000): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    this.cleanupTimer.unref();
  }

  /** Stop the cleanup timer. */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Manually trigger cleanup of expired sessions. */
  cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > this.ttlMs) {
        this.close(id);
      }
    }
    this.pool.cleanup();
  }

  /** Shut down all sessions and the pool. */
  shutdown(): void {
    this.stopCleanup();
    for (const id of this.sessions.keys()) {
      this.close(id);
    }
    this.pool.shutdown();
  }

  /** LRU eviction: remove the least recently accessed session. */
  private evictLru(): void {
    let oldest: { id: string; time: number } | null = null;
    for (const [id, session] of this.sessions.entries()) {
      if (!oldest || session.lastAccess < oldest.time) {
        oldest = { id, time: session.lastAccess };
      }
    }
    if (oldest) {
      this.close(oldest.id);
    }
  }

  /** For testing. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** For testing. */
  getPoolRefCount(projectId: string): number {
    return this.pool.getRefCount(projectId);
  }
}
