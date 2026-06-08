/**
 * Session types for MCP gateway hosting (F4).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IndexEngine } from '../index-engine/engine.js';

export interface McpSession {
  sessionId: string;
  apiKey: string;
  projectId: string;
  server: McpServer;
  createdAt: number;
  lastAccess: number;
}
