/**
 * CodeGraph Enterprise — MCP Server Gateway (HTTP/SSE mode)
 *
 * F4: MCP Server 网关托管（统一 MCP 端点、多 agent 会话复用）
 *
 * Starts both:
 *   1. Stdio MCP server (for Claude Code / Cursor direct integration)
 *   2. HTTP/SSE gateway (for remote multi-agent session reuse)
 *
 * Usage:
 *   MCP_HTTP_ENABLED=true node dist/server-http.js
 */

import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LocalSqliteEngine } from './index-engine/local.js';
import type { IndexEngine } from './index-engine/engine.js';
import { loadConfig, getIndexFilePath } from './config.js';
import { createMcpGatewayRouter } from './transport/http-sse.js';
import {
  registerSearchCode,
  registerGetSymbol,
  registerGetCallers,
  registerGetCallees,
  registerGetImpact,
  registerSearchRoutes,
  registerSearchFulltext,
} from './tools/index.js';

const config = loadConfig();

// ─── Shared MCP Server instance (tools registry) ─────────────────────────

const mcpServer = new McpServer({
  name: config.serverName,
  version: config.serverVersion,
});

// ─── Engine factory (for session pool) ───────────────────────────────────

function createEngine(): LocalSqliteEngine {
  return new LocalSqliteEngine(config.indexDir);
}

// ─── Register tools on the MCP Server (for stdio transport) ──────────────

const stdioEngine: IndexEngine = new LocalSqliteEngine(config.indexDir);

registerSearchCode(mcpServer, stdioEngine, config.apiKey);
registerGetSymbol(mcpServer, stdioEngine, config.apiKey);
registerGetCallers(mcpServer, stdioEngine, config.apiKey);
registerGetCallees(mcpServer, stdioEngine, config.apiKey);
registerGetImpact(mcpServer, stdioEngine, config.apiKey);
registerSearchRoutes(mcpServer, stdioEngine, config.apiKey);
registerSearchFulltext(mcpServer, stdioEngine, config.apiKey);

// ─── HTTP/SSE Gateway ────────────────────────────────────────────────────

async function startHttpGateway(): Promise<void> {
  if (!config.httpEnabled) {
    console.error('[mcp-server] HTTP gateway disabled (set MCP_HTTP_ENABLED=true to enable)');
    return;
  }

  const app = express();
  app.use(express.json());

  // Mount MCP gateway
  app.use(createMcpGatewayRouter(createEngine));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mcp-gateway', version: config.serverVersion });
  });

  // List indexes
  app.get('/api/indexes', (_req, res) => {
    try {
      const dirs = fs.readdirSync(config.indexDir, { withFileTypes: true });
      const projects = dirs
        .filter((d) => d.isDirectory())
        .map((d) => {
          const indexPath = getIndexFilePath(config.indexDir, d.name);
          const exists = fs.existsSync(indexPath);
          return { projectId: d.name, indexExists: exists, indexPath };
        });
      res.json({ projects });
    } catch {
      res.json({ projects: [] });
    }
  });

  const httpPort = config.httpPort;
  app.listen(httpPort, config.host, () => {
    console.error(`[mcp-server] HTTP/SSE gateway listening on http://${config.host}:${httpPort}`);
    console.error(`[mcp-server] Endpoints:`);
    console.error(`[mcp-server]   POST /mcp/sessions       — Create session`);
    console.error(`[mcp-server]   GET  /mcp/sessions       — List sessions`);
    console.error(`[mcp-server]   GET  /mcp/sessions/:id/stream — SSE stream`);
    console.error(`[mcp-server]   POST /mcp/sessions/:id/message — JSON-RPC`);
    console.error(`[mcp-server]   DELETE /mcp/sessions/:id  — Close session`);
    console.error(`[mcp-server]   POST /mcp                 — Create + message shorthand`);
    console.error(`[mcp-server]   GET  /health             — Health check`);
  });
}

// ─── Stdio transport (for Claude Code direct integration) ────────────────

async function startStdioServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[mcp-server] MCP Server started on stdio`);
  console.error(`[mcp-server] Server: ${config.serverName} v${config.serverVersion}`);
  console.error(`[mcp-server] Index dir: ${config.indexDir}`);
  console.error(`[mcp-server] Auth: ${config.apiKey ? 'enabled' : 'disabled (dev mode)'}`);
}

// ─── Main ────────────────────────────────────────────────────────────────

// Import fs for index listing
import * as fs from 'node:fs';

async function main() {
  // Always start stdio server (backward compatible)
  await startStdioServer();

  // Optionally start HTTP gateway
  if (config.httpEnabled) {
    await startHttpGateway();
  }
}

main().catch((err) => {
  console.error('[mcp-server] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('[mcp-server] Shutting down...');
  stdioEngine.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[mcp-server] Shutting down...');
  stdioEngine.close();
  process.exit(0);
});
