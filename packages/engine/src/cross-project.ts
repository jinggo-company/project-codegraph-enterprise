/**
 * Cross-Project Engine for CodeGraph Enterprise (F5).
 *
 * Aggregates search results from multiple project indexes
 * so that a single query can span all indexed projects
 * within an organization/team.
 *
 * Used by:
 *   - search_across_projects MCP tool
 *   - GET /api/organizations/:orgId/search API endpoint
 */

import type {
  IndexEngine,
  CodeSearchResult,
  SymbolInfo,
  CallEdge,
  FulltextResult,
  ImpactResult,
  RouteInfo,
} from './engine.js';
import { LocalSqliteEngine } from './local.js';

// ─── Cross-project search result types ───

export interface CrossProjectCodeResult extends CodeSearchResult {
  /** The project this result came from */
  project: string;
}

export interface CrossProjectSymbolResult extends SymbolInfo {
  project: string;
}

export interface CrossProjectCallEdge extends CallEdge {
  project: string;
}

export interface CrossProjectFulltextResult extends FulltextResult {
  project: string;
}

export interface CrossProjectRouteInfo extends RouteInfo {
  project: string;
}

export interface CrossProjectImpactResult extends ImpactResult {
  project: string;
}

// ─── Project filter ───

export interface CrossProjectFilter {
  /** Restrict search to specific projects (by project id) */
  projectIds?: string[];
  /** Filter by language */
  language?: string;
  /** Maximum results per project (default 50) */
  limit?: number;
  /** Maximum total results across all projects (default 500) */
  maxTotal?: number;
}

// ─── CrossProjectEngine ───

/**
 * Searches across multiple project indexes by opening each one
 * sequentially, collecting results, and merging them.
 *
 * Does NOT implement IndexEngine — it has a different interface
 * (no single project context).
 */
export class CrossProjectEngine {
  private indexDir: string;

  constructor(indexDir: string) {
    this.indexDir = indexDir;
  }

  /**
   * Search code symbols across multiple projects.
   * Returns aggregated results tagged with their source project.
   */
  async searchAcrossProjects(
    query: string,
    projectIds: string[],
    options?: CrossProjectFilter,
  ): Promise<CrossProjectCodeResult[]> {
    const allResults: CrossProjectCodeResult[] = [];
    const maxTotal = options?.maxTotal ?? 500;
    const perProjectLimit = options?.limit ?? 50;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.searchCode(query, {
          language: options?.language,
          limit: perProjectLimit,
        });
        for (const r of results) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip projects that can't be opened
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  /**
   * Search for a symbol across all given projects.
   */
  async searchSymbolAcrossProjects(
    symbolName: string,
    projectIds: string[],
    options?: CrossProjectFilter,
  ): Promise<CrossProjectSymbolResult[]> {
    const allResults: CrossProjectSymbolResult[] = [];
    const maxTotal = options?.maxTotal ?? 500;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.getSymbol(symbolName, {
          kind: options?.language, // reuse language field as kind filter
        });
        for (const r of results) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  /**
   * Search callers across projects.
   */
  async searchCallersAcrossProjects(
    symbolName: string,
    projectIds: string[],
    options?: CrossProjectFilter,
  ): Promise<CrossProjectCallEdge[]> {
    const allResults: CrossProjectCallEdge[] = [];
    const maxTotal = options?.maxTotal ?? 500;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.getCallers(symbolName);
        for (const r of results) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  /**
   * Full-text search across all given projects.
   */
  async searchFulltextAcrossProjects(
    query: string,
    projectIds: string[],
    options?: CrossProjectFilter,
  ): Promise<CrossProjectFulltextResult[]> {
    const allResults: CrossProjectFulltextResult[] = [];
    const maxTotal = options?.maxTotal ?? 500;
    const perProjectLimit = options?.limit ?? 50;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.searchFulltext(query, { limit: perProjectLimit });
        for (const r of results) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  /**
   * Search routes across all given projects.
   */
  async searchRoutesAcrossProjects(
    projectIds: string[],
    options?: { urlPattern?: string; framework?: string; maxTotal?: number; limit?: number },
  ): Promise<CrossProjectRouteInfo[]> {
    const allResults: CrossProjectRouteInfo[] = [];
    const maxTotal = options?.maxTotal ?? 500;
    const perProjectLimit = options?.limit ?? 50;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.searchRoutes({
          urlPattern: options?.urlPattern,
          framework: options?.framework,
        });
        for (const r of results.slice(0, perProjectLimit)) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  /**
   * Get impact analysis across projects for a given target symbol/file.
   * This searches each project individually and merges results.
   */
  async impactAcrossProjects(
    target: string,
    projectIds: string[],
    options?: CrossProjectFilter,
  ): Promise<CrossProjectImpactResult[]> {
    const allResults: CrossProjectImpactResult[] = [];
    const maxTotal = options?.maxTotal ?? 500;

    for (const projectId of projectIds) {
      if (allResults.length >= maxTotal) break;

      const engine = this._getEngine(projectId);
      if (!engine) continue;

      try {
        await engine.open(projectId);
        const results = engine.getImpact(target);
        for (const r of results) {
          allResults.push({ ...r, project: projectId });
        }
      } catch {
        // Skip
      } finally {
        engine.close();
      }
    }

    return allResults.slice(0, maxTotal);
  }

  // ─── Internal helpers ───

  private _getEngine(projectId: string): LocalSqliteEngine | null {
    const engine = new LocalSqliteEngine(this.indexDir);
    if (!engine.hasIndex(projectId)) {
      return null;
    }
    return engine;
  }
}
