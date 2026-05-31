/**
 * Remote index engine stub.
 * Placeholder for Phase 2+ where indexes are served via
 * a remote API rather than local SQLite files.
 */

import type {
  IndexEngine,
  SymbolInfo,
  CodeSearchResult,
  CallEdge,
  ImpactResult,
  RouteInfo,
  FulltextResult,
} from './engine.js';

export class RemoteEngine implements IndexEngine {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? process.env.CODEGRAPH_REMOTE_URL ?? 'http://localhost:4000';
  }

  hasIndex(_projectId: string): boolean {
    // In a real implementation, this would check the remote API.
    return false;
  }

  open(_projectId: string): void {
    // No local handle needed; each call goes through HTTP.
  }

  close(): void {
    // No-op
  }

  searchCode(_query: string, _options?: { language?: string; limit?: number }): CodeSearchResult[] {
    throw new Error('Remote engine not yet implemented');
  }

  getSymbol(_name: string, _options?: { kind?: string }): SymbolInfo[] {
    throw new Error('Remote engine not yet implemented');
  }

  getCallers(_name: string): CallEdge[] {
    throw new Error('Remote engine not yet implemented');
  }

  getCallees(_name: string): CallEdge[] {
    throw new Error('Remote engine not yet implemented');
  }

  getImpact(_target: string): ImpactResult[] {
    throw new Error('Remote engine not yet implemented');
  }

  searchRoutes(_options?: { urlPattern?: string; framework?: string }): RouteInfo[] {
    throw new Error('Remote engine not yet implemented');
  }

  searchFulltext(_query: string, _options?: { limit?: number }): FulltextResult[] {
    throw new Error('Remote engine not yet implemented');
  }
}
