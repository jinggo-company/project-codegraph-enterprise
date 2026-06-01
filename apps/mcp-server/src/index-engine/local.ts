/**
 * Local SQLite engine implementation.
 * Uses sql.js (pure-JS SQLite) — no native compilation needed.
 * Queries CodeGraph-generated SQLite index files (with FTS5 support).
 *
 * Schema conventions (based on CodeGraph output):
 *   - symbols:      name, kind, file, line, column, signature, documentation, language
 *   - call_edges:   caller, caller_file, caller_line, callee, callee_file, callee_line
 *   - routes:       method, path, handler, file, framework
 *   - fts_content:  file, line, content (backed by FTS5 virtual table)
 *
 * If the index file doesn't exist or lacks expected tables,
 * methods return empty arrays gracefully.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import * as fs from 'node:fs';
import type {
  IndexEngine,
  SymbolInfo,
  CodeSearchResult,
  CallEdge,
  ImpactResult,
  RouteInfo,
  FulltextResult,
} from './engine.js';
import { getIndexFilePath } from '../config.js';

type DbRow = Record<string, string | number | null>;

/** Lazy-initialized sql.js WASM module */
let _sqlJsDatabase: typeof SqlJsDatabase | null = null;

async function getDatabaseConstructor(): Promise<typeof SqlJsDatabase> {
  if (!_sqlJsDatabase) {
    const SQL = await initSqlJs();
    _sqlJsDatabase = SQL.Database as unknown as typeof SqlJsDatabase;
  }
  return _sqlJsDatabase;
}

/** Synchronous check — used only by hasIndex() */
function _syncHasIndex(filePath: string): boolean {
  try {
    // For hasIndex we need a sync check; sql.js requires WASM which is async.
    // We use a minimal file-existence + size check as a proxy.
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    if (stat.size < 100) return false; // SQLite header is 100 bytes
    // Read header to verify SQLite magic
    const header = fs.readFileSync(filePath).slice(0, 16).toString('utf8');
    return header.startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

export class LocalSqliteEngine implements IndexEngine {
  private db: SqlJsDatabase | null = null;
  private currentProjectId: string | null = null;

  constructor(private indexDir: string = process.env.CODEGRAPH_INDEX_DIR ?? './data/indexes') {}

  hasIndex(projectId: string): boolean {
    const filePath = getIndexFilePath(this.indexDir, projectId);
    return _syncHasIndex(filePath);
  }

  async open(projectId: string): Promise<void> {
    if (this.currentProjectId === projectId && this.db) return;
    this.close();
    const filePath = getIndexFilePath(this.indexDir, projectId);
    if (!fs.existsSync(filePath)) throw new Error(`Index file not found: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const Database = await getDatabaseConstructor();
    this.db = new Database(buffer);
    this.currentProjectId = projectId;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.currentProjectId = null;
    }
  }

  private getDb(): SqlJsDatabase {
    if (!this.db) throw new Error('No index open; call open(projectId) first');
    return this.db;
  }

  private _exec(sql: string, params: unknown[] = []): Array<{ columns: string[]; values: unknown[][] }> {
    const db = this.getDb();
    return db.exec(sql, params as unknown as Record<string, unknown>);
  }

  private _queryAll(sql: string, params: unknown[] = []): DbRow[] {
    const results = this._exec(sql, params);
    if (results.length === 0 || results[0].values.length === 0) return [];
    const { columns, values } = results[0];
    return values.map((row) => {
      const obj: DbRow = {};
      columns.forEach((col, i) => {
        obj[col] = row[i] ?? null;
      });
      return obj;
    });
  }

  // ─── search_code ──────────────────────────────────────────────────────
  searchCode(query: string, options?: { language?: string; limit?: number }): CodeSearchResult[] {
    const limit = options?.limit ?? 50;
    let sql = `SELECT name, kind, file, line, column,
                     COALESCE(signature, '') as signature,
                     COALESCE(language, '') as language
              FROM symbols WHERE name LIKE ?`;
    const params: (string | number)[] = [`%${query}%`];

    if (options?.language) {
      sql += ` AND language = ?`;
      params.push(options.language);
    }
    sql += ` ORDER BY line ASC LIMIT ?`;
    params.push(limit);

    const rows = this._queryAll(sql, params);
    return rows.map((r) => ({
      file: String(r.file),
      line: Number(r.line),
      column: Number(r.column ?? 0),
      symbol: String(r.name),
      kind: String(r.kind),
      snippet: String(r.signature ?? ''),
    }));
  }

  // ─── get_symbol ───────────────────────────────────────────────────────
  getSymbol(name: string, options?: { kind?: string }): SymbolInfo[] {
    let sql = `SELECT name, kind, file, line,
                      COALESCE(signature, '') as signature,
                      COALESCE(documentation, '') as documentation
               FROM symbols WHERE name = ?`;
    const params: string[] = [name];

    if (options?.kind) {
      sql += ` AND kind = ?`;
      params.push(options.kind);
    }

    const rows = this._queryAll(sql, params);
    return rows.map((r) => ({
      name: String(r.name),
      kind: String(r.kind),
      file: String(r.file),
      line: Number(r.line),
      signature: String(r.signature),
      documentation: String(r.documentation),
    }));
  }

  // ─── get_callers ──────────────────────────────────────────────────────
  getCallers(name: string): CallEdge[] {
    const rows = this._queryAll(
      `SELECT caller, caller_file, caller_line, callee, callee_file, callee_line
       FROM call_edges WHERE callee = ? LIMIT 200`,
      [name],
    );
    return rows.map((r) => ({
      caller: String(r.caller),
      callerFile: String(r.caller_file),
      callerLine: Number(r.caller_line),
      callee: String(r.callee),
      calleeFile: String(r.callee_file),
      calleeLine: Number(r.callee_line),
    }));
  }

  // ─── get_callees ──────────────────────────────────────────────────────
  getCallees(name: string): CallEdge[] {
    const rows = this._queryAll(
      `SELECT caller, caller_file, caller_line, callee, callee_file, callee_line
       FROM call_edges WHERE caller = ? LIMIT 200`,
      [name],
    );
    return rows.map((r) => ({
      caller: String(r.caller),
      callerFile: String(r.caller_file),
      callerLine: Number(r.caller_line),
      callee: String(r.callee),
      calleeFile: String(r.callee_file),
      calleeLine: Number(r.callee_line),
    }));
  }

  // ─── get_impact ───────────────────────────────────────────────────────
  getImpact(target: string): ImpactResult[] {
    const results: ImpactResult[] = [];
    const visited = new Set<string>();
    const queue: { symbol: string; file: string; kind: string; distance: number; path: string[] }[] = [];

    // Seed: find the target symbol first
    const seedRows = this._queryAll(
      `SELECT name, file, kind FROM symbols WHERE name = ? OR file = ? LIMIT 10`,
      [target, target],
    );
    for (const row of seedRows) {
      const sym = String(row.name);
      const file = String(row.file);
      const kind = String(row.kind);
      const key = `${sym}@${file}`;
      if (!visited.has(key)) {
        visited.add(key);
        const item = { symbol: sym, file, kind, distance: 0, path: [sym] };
        queue.push(item);
        results.push(item);
      }
    }

    // BFS through call_edges
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.distance >= 10) continue;

      const edges = this._queryAll(
        `SELECT callee, callee_file FROM call_edges WHERE caller = ? OR caller_file = ? LIMIT 100`,
        [current.symbol, current.file],
      );

      for (const edge of edges) {
        const calleeSym = String(edge.callee);
        const calleeFile = String(edge.callee_file);
        const key = `${calleeSym}@${calleeFile}`;
        if (!visited.has(key)) {
          visited.add(key);
          const kind = this._lookupSymbolKind(calleeSym);
          const newPath = [...current.path, calleeSym];
          const item = { symbol: calleeSym, file: calleeFile, kind, distance: current.distance + 1, path: newPath };
          results.push(item);
          queue.push({ ...item });
        }
      }
    }

    return results.sort((a, b) => a.distance - b.distance).slice(0, 500);
  }

  private _lookupSymbolKind(symbolName: string): string {
    const rows = this._queryAll('SELECT kind FROM symbols WHERE name = ? LIMIT 1', [symbolName]);
    return rows.length > 0 ? String(rows[0].kind) : 'unknown';
  }

  // ─── search_routes ────────────────────────────────────────────────────
  searchRoutes(options?: { urlPattern?: string; framework?: string }): RouteInfo[] {
    let sql = `SELECT method, path, handler, file, COALESCE(framework, '') as framework FROM routes WHERE 1=1`;
    const params: string[] = [];

    if (options?.urlPattern) {
      sql += ` AND path LIKE ?`;
      params.push(`%${options.urlPattern}%`);
    }
    if (options?.framework) {
      sql += ` AND framework = ?`;
      params.push(options.framework);
    }
    sql += ` LIMIT 200`;

    const rows = this._queryAll(sql, params);
    return rows.map((r) => ({
      method: String(r.method),
      path: String(r.path),
      handler: String(r.handler),
      file: String(r.file),
      framework: String(r.framework),
    }));
  }

  // ─── search_fulltext ──────────────────────────────────────────────────
  searchFulltext(query: string, options?: { limit?: number }): FulltextResult[] {
    const limit = options?.limit ?? 50;

    // Try FTS5 first; fall back to LIKE if FTS5 table doesn't exist
    try {
      const rows = this._queryAll(
        `SELECT file, line, content, bm25(fts_content) as score
         FROM fts_content WHERE fts_content MATCH ? ORDER BY score LIMIT ?`,
        [query, limit],
      );
      return rows.map((r) => ({
        file: String(r.file),
        line: Number(r.line),
        content: String(r.content),
        score: Number(r.score ?? 0),
      }));
    } catch {
      // FTS5 not available; use LIKE fallback
      const rows = this._queryAll(
        `SELECT file, line, content FROM fts_content WHERE content LIKE ? LIMIT ?`,
        [`%${query}%`, limit],
      );
      return rows.map((r) => ({
        file: String(r.file),
        line: Number(r.line),
        content: String(r.content),
        score: 0,
      }));
    }
  }
}
