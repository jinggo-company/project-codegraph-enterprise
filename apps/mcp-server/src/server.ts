/**
 * CodeGraph Enterprise — MCP Server Gateway
 *
 * Implements the MCP 2024-11-05 protocol via @modelcontextprotocol/sdk 1.6+.
 * Provides 7 tools for querying CodeGraph indexes:
 *   search_code, get_symbol, get_callers, get_callees,
 *   get_impact, search_routes, search_fulltext
 *
 * Transport: stdio (primary, for Claude Code / Cursor integration)
 *
 * Authentication:
 *   - API Key via MCP _meta or x-api-key header (optional, set MCP_API_KEY to enable)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LocalSqliteEngine } from './index-engine/local.js';
import type { IndexEngine } from './index-engine/engine.js';
import { loadConfig } from './config.js';
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
const engine: IndexEngine = new LocalSqliteEngine(config.indexDir);

// ─── Create MCP Server ────────────────────────────────────────────────

const mcpServer = new McpServer({
  name: config.serverName,
  version: config.serverVersion,
});

// ─── Register all 7 tools ─────────────────────────────────────────────

registerSearchCode(mcpServer, engine, config.apiKey);
registerGetSymbol(mcpServer, engine, config.apiKey);
registerGetCallers(mcpServer, engine, config.apiKey);
registerGetCallees(mcpServer, engine, config.apiKey);
registerGetImpact(mcpServer, engine, config.apiKey);
registerSearchRoutes(mcpServer, engine, config.apiKey);
registerSearchFulltext(mcpServer, engine, config.apiKey);

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error(`[mcp-server] MCP Server started on stdio`);
  console.error(`[mcp-server] Server: ${config.serverName} v${config.serverVersion}`);
  console.error(`[mcp-server] Index dir: ${config.indexDir}`);
  console.error(`[mcp-server] Auth: ${config.apiKey ? 'enabled' : 'disabled (dev mode)'}`);
  console.error(`[mcp-server] Tools: search_code, get_symbol, get_callers, get_callees, get_impact, search_routes, search_fulltext`);
}

main().catch((err) => {
  console.error('[mcp-server] Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.error('[mcp-server] Shutting down...');
  engine.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[mcp-server] Shutting down...');
  engine.close();
  process.exit(0);
});
