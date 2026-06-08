/**
 * HTTP/SSE Transport Server for MCP Gateway (F4).
 *
 * Implements MCP Streamable HTTP transport via Fastify:
 *   POST /mcp/message   — MCP JSON-RPC request/response
 *   GET  /mcp/sse       — SSE event stream (server → client push)
 *   GET  /mcp/health    — health check
 *
 * Multiple agents connect to the same endpoint, sessions are managed
 * by SessionManager for index engine reuse.
 */

import Fastify from 'fastify';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SessionManager } from './session/manager.js';
import { loadConfig } from './config.js';

export interface HttpServerOptions {
  port: number;
  indexDir: string;
  apiKey: string;
  serverName?: string;
  serverVersion?: string;
  maxSessions?: number;
  ttlMs?: number;
}

/**
 * MCP Gateway HTTP server.
 *
 * Each POST /mcp/message request creates or reuses an McpServer session
 * and pipes it through the StreamableHTTPServerTransport.
 */
export class McpHttpServer {
  private app = Fastify({ logger: false });
  private sessionManager: SessionManager;
  private transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(options: HttpServerOptions) {
    this.sessionManager = new SessionManager({
      indexDir: options.indexDir,
      apiKey: options.apiKey,
      maxSessions: options.maxSessions,
      ttlMs: options.ttlMs,
      serverName: options.serverName,
      serverVersion: options.serverVersion,
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // ─── Health check ───
    this.app.get('/mcp/health', async (_request, reply) => {
      return { status: 'ok', sessions: this.sessionManager.sessionCount };
    });

    // ─── SSE stream ───
    this.app.get('/mcp/sse', async (request, reply) => {
      const sessionId = (request.headers['mcp-session-id'] as string) ?? '';
      const transport = sessionId ? this.transports.get(sessionId) : undefined;
      if (!transport) {
        // No transport yet — this is the initial SSE connection.
        // The client will POST /mcp/message to initialize.
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        reply.raw.flushHeaders();
        // Keep the connection alive — it will be used by the transport
        // created during POST /mcp/message initialization.
        // We store a reference and send events when the transport is ready.
        request.raw.on('close', () => {
          // Client disconnected
        });
        return reply;
      }

      // Attach SSE to existing transport
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      reply.raw.flushHeaders();

      const writer = {
        write: (chunk: string) => {
          reply.raw.write(`event: message\ndata: ${chunk}\n\n`);
        },
      };
      await transport.startSSE(writer as any);
      return reply;
    });

    // ─── MCP message endpoint ───
    this.app.post('/mcp/message', async (request, reply) => {
      // Auth check
      const authError = this.checkAuth(request);
      if (authError) {
        return reply.status(401).send({ error: authError });
      }

      const sessionId = (request.headers['mcp-session-id'] as string) ?? '';
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId) {
        transport = this.transports.get(sessionId);
      }

      if (!transport) {
        // New session — check if project can be resolved from the request body
        const body = request.body as any;
        let projectId = body?.params?.project ?? '';

        if (!projectId) {
          // Try to resolve from API key → project mapping
          // For now, require project in the initialize params
          return reply.status(400).send({
            jsonrpc: '2.0',
            error: {
              code: -32600,
              message: 'Missing project identifier. Include "project" in initialize params.',
            },
            id: body?.id ?? null,
          });
        }

        // Create session
        const { session, sessionId: newId } = this.sessionManager.create(
          this.extractApiKey(request),
          projectId,
        );

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => newId,
        });

        this.transports.set(newId, transport);

        // Connect the McpServer to the transport
        await session.server.connect(transport);

        // Set up SSE for this transport
        const sseWriter = {
          write: (chunk: string) => {
            // SSE will be sent via the GET /mcp/sse endpoint
            // For streamable HTTP, responses come back on the POST
          },
        };

        transport.onclose = () => {
          this.transports.delete(newId);
          this.sessionManager.close(newId);
        };
      }

      // Handle the MCP request
      const rawReq = request.raw as IncomingMessage;
      const rawRes = reply.raw as ServerResponse;

      try {
        await transport.handleRequest(rawReq, rawRes, request.body as any);
      } catch (err: any) {
        this.app.log.error({ err }, 'MCP request handling failed');
        return reply.status(500).send({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }

      return reply;
    });
  }

  private checkAuth(request: any): string | null {
    const config = loadConfig();
    if (!config.apiKey) return null; // Dev mode, no auth

    const key = this.extractApiKey(request);
    if (!key) return 'Missing API key. Provide it via Authorization or x-api-key header.';
    if (key !== config.apiKey) return 'Invalid API key.';
    return null;
  }

  private extractApiKey(request: any): string {
    const auth = request.headers.authorization as string | undefined;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return (request.headers['x-api-key'] as string) ?? '';
  }

  async listen(port?: number): Promise<string> {
    const targetPort = port ?? loadConfig().httpPort ?? 5000;
    await this.app.listen({ port: targetPort, host: '0.0.0.0' });
    this.sessionManager.startCleanup();
    const address = `http://0.0.0.0:${targetPort}`;
    this.app.log.info(`MCP Gateway listening on ${address}`);
    return address;
  }

  async shutdown(): Promise<void> {
    this.sessionManager.shutdown();
    await this.app.close();
  }
}

/** Start the MCP HTTP server if MCP_HTTP_PORT > 0. */
export async function startHttpServerIfEnabled(): Promise<McpHttpServer | null> {
  const config = loadConfig();
  if (!config.httpPort || config.httpPort <= 0) {
    return null;
  }

  const server = new McpHttpServer({
    port: config.httpPort,
    indexDir: config.indexDir,
    apiKey: config.apiKey,
    serverName: config.serverName,
    serverVersion: config.serverVersion,
  });

  await server.listen(config.httpPort);
  return server;
}
