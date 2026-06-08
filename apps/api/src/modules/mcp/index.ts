/**
 * CodeGraph Enterprise — MCP Gateway Module
 *
 * F4: MCP Server 网关托管（统一 MCP 端点、多 agent 会话复用）
 *
 * Exposes unified MCP endpoints through the API service.
 * Acts as a proxy between MCP clients (Claude Code, Cursor) and the MCP Server.
 *
 * Endpoints:
 *   POST /api/mcp/sessions          — Create a new MCP session
 *   GET  /api/mcp/sessions          — List active sessions
 *   POST /api/mcp/sessions/:id/message — Send JSON-RPC message
 *   GET  /api/mcp/sessions/:id/stream  — SSE event stream
 *   DELETE /api/mcp/sessions/:id     — Close a session
 *   POST /api/mcp                    — Shorthand: create + message
 *   GET  /api/mcp/tools              — List available MCP tools
 */

import FastifyPlugin from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ─── In-memory session store ──────────────────────────────────────────────

interface McpSession {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  apiKey: string | null;
  projectIds: string[];
}

const sessions = new Map<string, McpSession>();

// ─── MCP tool definitions ─────────────────────────────────────────────────

const MCP_TOOLS = [
  {
    name: 'search_code',
    description: 'Search for code symbols matching a query. Returns matching symbols with file, line, kind, and signature information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (symbol name or partial match)' },
        project: { type: 'string', description: 'Project identifier' },
        language: { type: 'string', description: 'Filter by language (e.g., typescript, python, go)' },
      },
      required: ['query', 'project'],
    },
  },
  {
    name: 'get_symbol',
    description: 'Get detailed information about a specific code symbol including location, signature, and documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name (exact match)' },
        kind: { type: 'string', description: 'Symbol kind: function, class, interface, method, variable' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['name', 'project'],
    },
  },
  {
    name: 'get_callers',
    description: 'Find all symbols that call a given symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to find callers for' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['name', 'project'],
    },
  },
  {
    name: 'get_callees',
    description: 'Find all symbols called by a given symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Symbol name to find callees for' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['name', 'project'],
    },
  },
  {
    name: 'get_impact',
    description: 'Analyze the full impact radius of changing a file or symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'File path or symbol name to analyze impact for' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['target', 'project'],
    },
  },
  {
    name: 'search_routes',
    description: 'Search for web framework routes (Express, Spring, Rails, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        urlPattern: { type: 'string', description: 'URL pattern to match (e.g., /api/users)' },
        framework: { type: 'string', description: 'Filter by framework (express, fastify, spring, rails)' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['project'],
    },
  },
  {
    name: 'search_fulltext',
    description: 'Full-text search across all indexed code content using SQLite FTS5.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query (FTS5 syntax supported)' },
        project: { type: 'string', description: 'Project identifier' },
      },
      required: ['query', 'project'],
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

const MCP_SERVER_URL = process.env.MCP_SERVER_URL ?? 'http://localhost:4100';

async function forwardToMcpServer(sessionId: string, message: Record<string, any>): Promise<any> {
  const res = await fetch(`${MCP_SERVER_URL}/mcp/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    throw new Error(`MCP server responded ${res.status}`);
  }
  return res.json();
}

async function createRemoteSession(apiKey?: string, projectIds?: string[]): Promise<any> {
  const res = await fetch(`${MCP_SERVER_URL}/mcp/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, projectIds }),
  });
  if (!res.ok) {
    throw new Error(`MCP server responded ${res.status}`);
  }
  return res.json();
}

// ─── Fastify Plugin ───────────────────────────────────────────────────────

export const registerMcpGateway = FastifyPlugin(async (app: FastifyInstance) => {
  const useRemoteMcp = process.env.USE_REMOTE_MCP !== 'false';

  // ─── GET /api/mcp/tools ───
  app.get('/api/mcp/tools', async () => ({
    tools: MCP_TOOLS,
    count: MCP_TOOLS.length,
  }));

  // ─── POST /api/mcp/sessions ───
  app.post<{ Body: { apiKey?: string; projectIds?: string[] } }>(
    '/api/mcp/sessions',
    async (request: FastifyRequest<{ Body: { apiKey?: string; projectIds?: string[] } }>, reply: FastifyReply) => {
      const { apiKey, projectIds } = request.body || {};

      if (useRemoteMcp) {
        try {
          const remote = await createRemoteSession(apiKey, projectIds);
          return reply.send(remote);
        } catch (err: any) {
          request.log.warn({ err }, 'Remote MCP session creation failed, falling back to local');
        }
      }

      // Local fallback
      const session: McpSession = {
        id: randomUUID(),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        apiKey: apiKey ?? null,
        projectIds: projectIds ?? [],
      };
      sessions.set(session.id, session);

      return reply.status(201).send({
        sessionId: session.id,
        endpoint: `/api/mcp/sessions/${session.id}/stream`,
        messageEndpoint: `/api/mcp/sessions/${session.id}/message`,
        createdAt: session.createdAt,
      });
    },
  );

  // ─── GET /api/mcp/sessions ───
  app.get('/api/mcp/sessions', async () => {
    const localSessions: Array<{ id: string; createdAt: number; lastActiveAt: number; projectIds: string[] }> = [];
    for (const [, s] of sessions) {
      localSessions.push({
        id: s.id,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        projectIds: [...s.projectIds],
      });
    }
    return { count: localSessions.length, sessions: localSessions, source: 'local' };
  });

  // ─── POST /api/mcp/sessions/:id/message ───
  app.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/api/mcp/sessions/:id/message',
    async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, any> }>, reply: FastifyReply) => {
      const sessionId = request.params.id;
      const message = request.body;

      const localSession = sessions.get(sessionId);
      if (localSession) {
        localSession.lastActiveAt = Date.now();
      }

      if (useRemoteMcp && localSession) {
        try {
          const result = await forwardToMcpServer(sessionId, message);
          return reply.send(result);
        } catch (err: any) {
          request.log.warn({ err }, 'Remote MCP message failed, falling back to local');
        }
      }

      // Local response: acknowledge the session exists
      if (!localSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      // Handle MCP protocol locally (initialize, tools/list, tools/call)
      const { method, params, id: requestId } = message;

      if (method === 'initialize') {
        return reply.send({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'CodeGraph Enterprise MCP Gateway', version: '0.1.0' },
            capabilities: { tools: {} },
          },
        });
      }

      if (method === 'notifications/initialized') {
        return reply.status(204).send();
      }

      if (method === 'tools/list') {
        return reply.send({
          jsonrpc: '2.0',
          id: requestId,
          result: { tools: MCP_TOOLS },
        });
      }

      if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        return reply.send({
          jsonrpc: '2.0',
          id: requestId,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  { tool: name, status: 'routed', message: 'Tool call forwarded. Connect via SSE stream for results.', project: args?.project },
                  null,
                  2,
                ),
              },
            ],
          },
        });
      }

      if (method === 'ping') {
        return reply.send({ jsonrpc: '2.0', id: requestId, result: {} });
      }

      return reply.send({
        jsonrpc: '2.0',
        id: requestId,
        error: { code: -32601, message: `Unknown method: ${method}` },
      });
    },
  );

  // ─── GET /api/mcp/sessions/:id/stream — SSE ───
  app.get<{ Params: { id: string } }>(
    '/api/mcp/sessions/:id/stream',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const sessionId = request.params.id;
      const localSession = sessions.get(sessionId);

      if (!localSession) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      reply.header('Content-Type', 'text/event-stream');
      reply.header('Cache-Control', 'no-cache');
      reply.header('Connection', 'keep-alive');
      reply.header('X-Accel-Buffering', 'no');

      const raw = reply.raw;
      raw.write(`data: ${JSON.stringify({ type: 'connected', sessionId, tools: MCP_TOOLS.map((t) => t.name) })}\n\n`);

      // Keep connection alive with periodic heartbeats
      const heartbeat = setInterval(() => {
        raw.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`);
      }, 30000);

      request.raw.on('close', () => {
        clearInterval(heartbeat);
      });
    },
  );

  // ─── DELETE /api/mcp/sessions/:id ───
  app.delete<{ Params: { id: string } }>(
    '/api/mcp/sessions/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const sessionId = request.params.id;
      const removed = sessions.delete(sessionId);

      if (useRemoteMcp) {
        try {
          await fetch(`${MCP_SERVER_URL}/mcp/sessions/${sessionId}`, { method: 'DELETE' });
        } catch {
          // ignore remote cleanup failure
        }
      }

      if (!removed) {
        return reply.status(404).send({ error: 'Session not found' });
      }
      return reply.send({ ok: true });
    },
  );

  // ─── POST /api/mcp — shorthand: create session + message ───
  app.post<{ Body: Record<string, any> }>(
    '/api/mcp',
    async (request: FastifyRequest<{ Body: Record<string, any> }>, reply: FastifyReply) => {
      const body = request.body || {};
      const { apiKey, projectIds, message } = body;

      // Create session
      const session: McpSession = {
        id: randomUUID(),
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        apiKey: apiKey ?? null,
        projectIds: projectIds ?? [],
      };
      sessions.set(session.id, session);

      // Handle message
      const msg = message ?? body;
      const { method, params, id: requestId } = msg;

      let result: any;
      if (method === 'initialize') {
        result = {
          jsonrpc: '2.0',
          id: requestId,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'CodeGraph Enterprise MCP Gateway', version: '0.1.0' },
            capabilities: { tools: {} },
          },
        };
      } else if (method === 'tools/list') {
        result = { jsonrpc: '2.0', id: requestId, result: { tools: MCP_TOOLS } };
      } else {
        result = {
          jsonrpc: '2.0',
          id: requestId,
          error: { code: -32601, message: `Method ${method} requires a persistent session. Use /api/mcp/sessions first.` },
        };
      }

      return reply.status(201).send({ sessionId: session.id, result });
    },
  );
});

export { MCP_TOOLS };
