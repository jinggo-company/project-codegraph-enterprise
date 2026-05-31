/**
 * Index Engine interface for CodeGraph Enterprise.
 * Abstracts the SQLite/FTS5 query layer so the MCP tools
 * don't need to know the storage details.
 */

// ─── Result Types ───

export interface SymbolInfo {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
  documentation: string;
}

export interface CodeSearchResult {
  file: string;
  line: number;
  column: number;
  symbol: string;
  kind: string;
  snippet: string;
}

export interface CallEdge {
  caller: string;
  callerFile: string;
  callerLine: number;
  callee: string;
  calleeFile: string;
  calleeLine: number;
}

export interface ImpactResult {
  symbol: string;
  file: string;
  kind: string;
  distance: number;
  path: string[];
}

export interface RouteInfo {
  method: string;
  path: string;
  handler: string;
  file: string;
  framework: string;
}

export interface FulltextResult {
  file: string;
  line: number;
  content: string;
  score: number;
}

// ─── IndexEngine Interface ───

export interface IndexEngine {
  /** Open the index for a project; throws if no valid index exists */
  open(projectId: string): void;

  /** Close any open index handle */
  close(): void;

  /** Check whether an index is available for the project */
  hasIndex(projectId: string): boolean;

  // Core query methods
  searchCode(query: string, options?: { language?: string; limit?: number }): CodeSearchResult[];
  getSymbol(name: string, options?: { kind?: string }): SymbolInfo[];
  getCallers(name: string): CallEdge[];
  getCallees(name: string): CallEdge[];
  getImpact(target: string): ImpactResult[];
  searchRoutes(options?: { urlPattern?: string; framework?: string }): RouteInfo[];
  searchFulltext(query: string, options?: { limit?: number }): FulltextResult[];
}

// NOTE: Factory function removed — consumers should import LocalSqliteEngine
// directly from './local.js' to avoid circular ESM imports with better-sqlite3.
