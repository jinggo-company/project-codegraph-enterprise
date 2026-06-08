import path from 'node:path';

/**
 * MCP Server configuration.
 * Environment variables are the single source of truth.
 */

export interface McpConfig {
  /** Directory where SQLite index files are stored */
  indexDir: string;
  /** API Key for authentication (empty = disabled, for local dev only) */
  apiKey: string;
  /** Server name */
  serverName: string;
  /** Server version */
  serverVersion: string;
  /** HTTP transport port (0 = stdio only) */
  httpPort: number;
  /** Whether HTTP gateway is enabled */
  httpEnabled: boolean;
  /** Bind host */
  host: string;
}

export function loadConfig(): McpConfig {
  return {
    indexDir: process.env.CODEGRAPH_INDEX_DIR ?? path.join(process.cwd(), 'data', 'indexes'),
    apiKey: process.env.MCP_API_KEY ?? '',
    serverName: process.env.MCP_SERVER_NAME ?? 'codegraph-enterprise',
    serverVersion: process.env.MCP_SERVER_VERSION ?? '0.1.0',
    httpPort: parseInt(process.env.MCP_HTTP_PORT ?? '0', 10),
    httpEnabled: process.env.MCP_HTTP_ENABLED === 'true' || parseInt(process.env.MCP_HTTP_PORT ?? '0', 10) > 0,
    host: process.env.MCP_HOST ?? '0.0.0.0',
  };
}

/** Resolve the SQLite index file path for a given project */
export function getIndexFilePath(indexDir: string, projectId: string): string {
  return path.join(indexDir, projectId, 'index.db');
}
