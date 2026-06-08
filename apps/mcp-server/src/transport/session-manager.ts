/**
 * CodeGraph Enterprise — MCP Session Manager
 *
 * Manages MCP sessions for multi-agent session reuse.
 * Multiple agent instances (Claude Code sessions, Cursor windows) can share
 * the same underlying index resources, avoiding redundant SQLite loads.
 *
 * Key features:
 * - Index pool: shared IndexEngine instances across sessions
 * - Session lifecycle: create, reuse, timeout, cleanup
 * - Multi-agent routing: route requests to the correct project indexes
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { LocalSqliteEngine } from '../index-engine/local.js';

// ─── Index Pool ──────────────────────────────────────────────────────────

interface PoolEntry {
  engine: LocalSqliteEngine;
  refCount: number;
}

/**
 * Shared index pool: maps projectId → { engine, refCount }
 * Multiple sessions can reference the same engine instance,
 * avoiding redundant SQLite file loads.
 */
class IndexPool {
  private pool = new Map<string, PoolEntry>();
  private engineFactory: () => LocalSqliteEngine;

  constructor(factory: () => LocalSqliteEngine) {
    this.engineFactory = factory;
  }

  acquire(projectId: string): LocalSqliteEngine {
    let entry = this.pool.get(projectId);
    if (!entry) {
      entry = { engine: this.engineFactory(), refCount: 0 };
      this.pool.set(projectId, entry);
    }
    entry.refCount++;
    return entry.engine;
  }

  release(projectId: string): void {
    const entry = this.pool.get(projectId);
    if (!entry) return;
    entry.refCount--;
    if (entry.refCount <= 0) {
      try {
        entry.engine.close();
      } catch {
        // ignore
      }
      this.pool.delete(projectId);
    }
  }

  cleanup(): void {
    for (const [, entry] of this.pool) {
      try {
        entry.engine.close();
      } catch {
        // ignore
      }
    }
    this.pool.clear();
  }
}

// ─── Active Session Record ───────────────────────────────────────────────

export interface ActiveSession {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  projectIds: string[];
}

// ─── Session (EventEmitter-backed object for HTTP transport) ─────────────

export class McpSession extends EventEmitter {
  readonly id: string;
  readonly createdAt: number;
  lastActiveAt: number;
  apiKey: string | null;
  projectIds: string[];
  private engine: LocalSqliteEngine | null;
  private indexPool: IndexPool;

  constructor(id: string, pool: IndexPool) {
    super();
    this.id = id;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.apiKey = null;
    this.projectIds = [];
    this.engine = null;
    this.indexPool = pool;
  }

  setApiKey(key: string): void {
    this.apiKey = key;
    this.lastActiveAt = Date.now();
  }

  preloadIndexes(ids: string[]): void {
    for (const projectId of ids) {
      if (!this.projectIds.includes(projectId)) {
        this.projectIds.push(projectId);
        this.indexPool.acquire(projectId);
      }
    }
    this.lastActiveAt = Date.now();
  }

  getEngineForProject(projectId: string): LocalSqliteEngine | null {
    if (!this.projectIds.includes(projectId)) return null;
    if (!this.engine) {
      this.engine = this.indexPool.acquire(projectId);
    }
    this.lastActiveAt = Date.now();
    return this.engine;
  }

  /**
   * Handle a JSON-RPC message from an MCP client.
   * Dispatches to appropriate tool handlers.
   */
  async handleMessage(msg: Record<string, any>): Promise<any> {
    this.lastActiveAt = Date.now();
    const { method, params, id: requestId } = msg;

    // MCP initialize
    if (method === 'initialize') {
      this.emit('server-event', {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'CodeGraph Enterprise MCP Gateway', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      });
      return {
        jsonrpc: '2.0',
        id: requestId,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'CodeGraph Enterprise MCP Gateway', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      };
    }

    // MCP initialized notification
    if (method === 'notifications/initialized') {
      return null;
    }

    // tools/list
    if (method === 'tools/list') {
      const tools = [
        { name: 'search_code', description: 'Search for code symbols', inputSchema: { type: 'object', properties: { query: { type: 'string' }, project: { type: 'string' }, language: { type: 'string' } }, required: ['query', 'project'] } },
        { name: 'get_symbol', description: 'Get symbol details', inputSchema: { type: 'object', properties: { name: { type: 'string' }, kind: { type: 'string' }, project: { type: 'string' } }, required: ['name', 'project'] } },
        { name: 'get_callers', description: 'Find callers of a symbol', inputSchema: { type: 'object', properties: { name: { type: 'string' }, project: { type: 'string' } }, required: ['name', 'project'] } },
        { name: 'get_callees', description: 'Find callees of a symbol', inputSchema: { type: 'object', properties: { name: { type: 'string' }, project: { type: 'string' } }, required: ['name', 'project'] } },
        { name: 'get_impact', description: 'Analyze impact radius', inputSchema: { type: 'object', properties: { target: { type: 'string' }, project: { type: 'string' } }, required: ['target', 'project'] } },
        { name: 'search_routes', description: 'Search web framework routes', inputSchema: { type: 'object', properties: { urlPattern: { type: 'string' }, framework: { type: 'string' }, project: { type: 'string' } }, required: ['project'] } },
        { name: 'search_fulltext', description: 'Full-text search code content', inputSchema: { type: 'object', properties: { query: { type: 'string' }, project: { type: 'string' } }, required: ['query', 'project'] } },
      ];
      this.emit('server-event', {
        jsonrpc: '2.0',
        id: requestId,
        result: { tools },
      });
      return { jsonrpc: '2.0', id: requestId, result: { tools } };
    }

    // tools/call — dispatch to engine queries
    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      const engine = this.engine;
      const projectId = args?.project;

      if (!engine) {
        const error = {
          jsonrpc: '2.0',
          id: requestId,
          error: { code: -32603, message: 'No index engine loaded. Call initialize first.' },
        };
        this.emit('server-event', error);
        return error;
      }

      try {
        if (!projectId || !this.projectIds.includes(projectId)) {
          const error = {
            jsonrpc: '2.0',
            id: requestId,
            error: { code: -32000, message: `Project "${projectId}" not available in this session.` },
          };
          this.emit('server-event', error);
          return error;
        }

        engine.open(projectId);
        let result: any;

        switch (name) {
          case 'search_code':
            result = engine.searchCode(args.query, { language: args.language, limit: 50 });
            break;
          case 'get_symbol':
            result = engine.getSymbol(args.name, args.kind ? { kind: args.kind } : undefined);
            break;
          case 'get_callers':
            result = engine.getCallers(args.name);
            break;
          case 'get_callees':
            result = engine.getCallees(args.name);
            break;
          case 'get_impact':
            result = engine.getImpact(args.target);
            break;
          case 'search_routes':
            result = engine.searchRoutes({ urlPattern: args.urlPattern, framework: args.framework });
            break;
          case 'search_fulltext':
            result = engine.searchFulltext(args.query, { limit: 50 });
            break;
          default:
            return {
              jsonrpc: '2.0',
              id: requestId,
              error: { code: -32601, message: `Unknown tool: ${name}` },
            };
        }

        const response = {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ tool: name, count: result.length, data: result }, null, 2) }],
          },
        };
        this.emit('server-event', response);
        return response;
      } finally {
        engine.close();
      }
    }

    // ping
    if (method === 'ping') {
      return { jsonrpc: '2.0', id: requestId, result: {} };
    }

    return {
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -32601, message: `Unknown method: ${method}` },
    };
  }
}

// ─── Session Manager (Singleton) ─────────────────────────────────────────

export class McpSessionManager extends EventEmitter {
  private sessions = new Map<string, McpSession>();
  private indexPool: IndexPool;
  private idleTimeoutMs: number;

  constructor(engineFactory: () => LocalSqliteEngine, idleTimeoutMs = 30 * 60 * 1000) {
    super();
    this.indexPool = new IndexPool(engineFactory);
    this.idleTimeoutMs = idleTimeoutMs;
  }

  createSession(): McpSession {
    const session = new McpSession(randomUUID(), this.indexPool);
    this.sessions.set(session.id, session);
    console.error(`[session-manager] Created session ${session.id}`);
    return session;
  }

  getSession(sessionId: string): McpSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.lastActiveAt = Date.now();
    return session;
  }

  closeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    for (const projectId of session.projectIds) {
      this.indexPool.release(projectId);
    }
    this.sessions.delete(sessionId);
    console.error(`[session-manager] Closed session ${sessionId}`);
    return true;
  }

  listActiveSessions(): ActiveSession[] {
    const result: ActiveSession[] = [];
    for (const [, session] of this.sessions) {
      result.push({
        id: session.id,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        projectIds: [...session.projectIds],
      });
    }
    return result;
  }

  cleanupIdleSessions(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActiveAt > this.idleTimeoutMs) {
        this.closeSession(id);
        count++;
      }
    }
    return count;
  }

  cleanup(): void {
    for (const [id] of this.sessions) {
      this.closeSession(id);
    }
    this.indexPool.cleanup();
  }
}
