/**
 * CodeGraph Enterprise — MCP Server HTTP/SSE Transport Adapter
 *
 * Provides a unified HTTP endpoint with SSE streaming for remote MCP connections.
 * Used by Claude Code, Cursor, and other MCP clients via HTTP transport.
 *
 * F4: MCP Server 网关托管（统一 MCP 端点、多 agent 会话复用）
 *
 * Endpoints:
 *   POST /mcp/sessions          — Create a new MCP session
 *   GET  /mcp/sessions          — List active sessions
 *   GET  /mcp/sessions/:id/stream — SSE event stream
 *   POST /mcp/sessions/:id/message — JSON-RPC message
 *   DELETE /mcp/sessions/:id    — Close a session
 *   POST /mcp                   — Shorthand: create session + send message in one call
 */

import express from 'express';
import type { LocalSqliteEngine } from '../index-engine/local.js';
import { McpSessionManager } from './session-manager.js';

export function createMcpGatewayRouter(
  engineFactory: () => LocalSqliteEngine,
): express.Router {
  const router = express.Router();
  const manager = new McpSessionManager(engineFactory);

  // ─── POST /mcp/sessions — create a new MCP session ───
  router.post('/mcp/sessions', (req, res) => {
    const session = manager.createSession();
    const body = req.body as Record<string, any> | undefined;
    if (body?.apiKey) session.setApiKey(body.apiKey);
    if (body?.projectIds && Array.isArray(body.projectIds)) {
      session.preloadIndexes(body.projectIds);
    }
    res.status(201).json({
      sessionId: session.id,
      endpoint: `/mcp/sessions/${session.id}/stream`,
      messageEndpoint: `/mcp/sessions/${session.id}/message`,
      createdAt: session.createdAt,
    });
  });

  // ─── GET /mcp/sessions — list active sessions ───
  router.get('/mcp/sessions', (_req, res) => {
    const sessions = manager.listActiveSessions();
    res.json({ count: sessions.length, sessions });
  });

  // ─── GET /mcp/sessions/:id/stream — SSE endpoint ───
  router.get('/mcp/sessions/:id/stream', (req, res) => {
    const session = manager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const onEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    session.on('server-event', onEvent);

    req.on('close', () => {
      session.off('server-event', onEvent);
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', sessionId: session.id })}\n\n`);
  });

  // ─── POST /mcp/sessions/:id/message — JSON-RPC message ───
  router.post('/mcp/sessions/:id/message', async (req, res) => {
    const session = manager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const body = req.body as Record<string, any>;
    try {
      const result = await session.handleMessage(body);
      if (result === null) {
        return res.status(204).end();
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message ?? 'Internal error' },
        id: body?.id ?? null,
      });
    }
  });

  // ─── DELETE /mcp/sessions/:id — close a session ───
  router.delete('/mcp/sessions/:id', (req, res) => {
    const closed = manager.closeSession(req.params.id);
    if (!closed) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  });

  // ─── POST /mcp — shorthand: create session + send message ───
  router.post('/mcp', async (req, res) => {
    const session = manager.createSession();
    const body = req.body as Record<string, any>;
    if (body?.apiKey) session.setApiKey(body.apiKey);
    if (body?.projectIds && Array.isArray(body.projectIds)) {
      session.preloadIndexes(body.projectIds);
    }
    const msg = body.message ?? body;
    try {
      const result = await session.handleMessage(msg);
      res.json({
        sessionId: session.id,
        result,
      });
    } catch (err: any) {
      res.status(500).json({
        sessionId: session.id,
        error: err.message ?? 'Internal error',
      });
    }
  });

  // Graceful cleanup on process exit
  process.on('SIGINT', () => {
    manager.cleanup();
  });
  process.on('SIGTERM', () => {
    manager.cleanup();
  });

  return router;
}
