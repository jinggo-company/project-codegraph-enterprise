/**
 * MCP tool registration for CodeGraph Enterprise.
 * Each function returns a tool definition that can be
 * registered with the McpServer instance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { IndexEngine } from '../index-engine/engine.js';
import { CrossProjectEngine } from '../index-engine/cross-project.js';
import { isAuthRequired, validateApiKey, extractApiKey } from '../middleware/auth.js';

// ─── Re-export cross-project tools ───
export {
  registerSearchAcrossProjects,
  registerSearchSymbolAcrossProjects,
  registerSearchCallersAcrossProjects,
  registerSearchFulltextAcrossProjects,
  registerSearchRoutesAcrossProjects,
} from './cross-project.js';

// ─── Helper: wrap tool handler with auth + project validation ───

function withAuthAndProject(
  apiKey: string,
  headers: Record<string, string> | undefined,
): { error: string } | null {
  // Skip auth if no key configured (dev mode)
  if (!isAuthRequired(apiKey)) return null;

  const candidate = extractApiKey(headers);
  if (!candidate) {
    return { error: 'Missing API key. Provide it via x-api-key header.' };
  }

  if (!validateApiKey(candidate, apiKey)) {
    return { error: 'Invalid API key. Authentication failed.' };
  }

  return null;
}

function makeTextResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  };
}

// ─── Tool: search_code ──────────────────────────────────────────────────
export function registerSearchCode(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'search_code',
    'Search for code symbols matching a query. Returns matching symbols with file, line, kind, and signature information.',
    {
      query: z.string().describe('Search query (symbol name or partial match)'),
      project: z.string().describe('Project identifier'),
      language: z.string().optional().describe('Filter by language (e.g., typescript, python, go)'),
    },
    async ({ query, project, language }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}". Build an index first.` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.searchCode(query, { language, limit: 50 });
        return makeTextResult(
          JSON.stringify(
            {
              query,
              project,
              language,
              count: results.length,
              results: results.map((r) => ({
                file: r.file,
                line: r.line,
                column: r.column,
                symbol: r.symbol,
                kind: r.kind,
                snippet: r.snippet,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: get_symbol ───────────────────────────────────────────────────
export function registerGetSymbol(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'get_symbol',
    'Get detailed information about a specific code symbol including location, signature, and documentation.',
    {
      name: z.string().describe('Symbol name (exact match)'),
      kind: z.string().optional().describe('Symbol kind: function, class, interface, method, variable, etc.'),
      project: z.string().describe('Project identifier'),
    },
    async ({ name, kind, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.getSymbol(name, kind ? { kind } : undefined);
        return makeTextResult(
          JSON.stringify(
            {
              name,
              kind,
              project,
              count: results.length,
              symbols: results.map((r) => ({
                name: r.name,
                kind: r.kind,
                file: r.file,
                line: r.line,
                signature: r.signature,
                documentation: r.documentation,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: get_callers ──────────────────────────────────────────────────
export function registerGetCallers(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'get_callers',
    'Find all symbols that call a given symbol. Useful for understanding who invokes a function or method.',
    {
      name: z.string().describe('Symbol name to find callers for'),
      project: z.string().describe('Project identifier'),
    },
    async ({ name, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.getCallers(name);
        return makeTextResult(
          JSON.stringify(
            {
              name,
              project,
              count: results.length,
              callers: results.map((r) => ({
                caller: r.caller,
                callerFile: r.callerFile,
                callerLine: r.callerLine,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: get_callees ──────────────────────────────────────────────────
export function registerGetCallees(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'get_callees',
    'Find all symbols called by a given symbol. Useful for understanding dependencies of a function.',
    {
      name: z.string().describe('Symbol name to find callees for'),
      project: z.string().describe('Project identifier'),
    },
    async ({ name, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.getCallees(name);
        return makeTextResult(
          JSON.stringify(
            {
              name,
              project,
              count: results.length,
              callees: results.map((r) => ({
                callee: r.callee,
                calleeFile: r.calleeFile,
                calleeLine: r.calleeLine,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: get_impact ───────────────────────────────────────────────────
export function registerGetImpact(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'get_impact',
    'Analyze the full impact radius of changing a file or symbol. Returns all transitively affected symbols with BFS depth.',
    {
      target: z.string().describe('File path or symbol name to analyze impact for'),
      project: z.string().describe('Project identifier'),
    },
    async ({ target, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.getImpact(target);
        return makeTextResult(
          JSON.stringify(
            {
              target,
              project,
              count: results.length,
              maxDepth: results.length > 0 ? Math.max(...results.map((r) => r.distance)) : 0,
              impact: results.map((r) => ({
                symbol: r.symbol,
                file: r.file,
                kind: r.kind,
                distance: r.distance,
                path: r.path,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: search_routes ────────────────────────────────────────────────
export function registerSearchRoutes(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'search_routes',
    'Search for web framework routes (Express, Spring, Rails, etc.). Returns route method, path, and handler mapping.',
    {
      urlPattern: z.string().optional().describe('URL pattern to match (e.g., /api/users)'),
      framework: z.string().optional().describe('Filter by framework (express, fastify, spring, rails, etc.)'),
      project: z.string().describe('Project identifier'),
    },
    async ({ urlPattern, framework, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.searchRoutes({
          urlPattern: urlPattern ?? '',
          framework: framework ?? '',
        });
        return makeTextResult(
          JSON.stringify(
            {
              urlPattern,
              framework,
              project,
              count: results.length,
              routes: results.map((r) => ({
                method: r.method,
                path: r.path,
                handler: r.handler,
                file: r.file,
                framework: r.framework,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}

// ─── Tool: search_fulltext ──────────────────────────────────────────────
export function registerSearchFulltext(server: McpServer, engine: IndexEngine, apiKey: string) {
  server.tool(
    'search_fulltext',
    'Full-text search across all indexed code content using SQLite FTS5. Returns matching code snippets with scores.',
    {
      query: z.string().describe('Full-text search query (FTS5 syntax supported)'),
      project: z.string().describe('Project identifier'),
    },
    async ({ query, project }, extra) => {
      const authError = withAuthAndProject(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (!engine.hasIndex(project)) {
        return makeTextResult(
          JSON.stringify({ error: `No valid index found for project "${project}".` }),
        );
      }

      engine.open(project);
      try {
        const results = engine.searchFulltext(query, { limit: 50 });
        return makeTextResult(
          JSON.stringify(
            {
              query,
              project,
              count: results.length,
              results: results.map((r) => ({
                file: r.file,
                line: r.line,
                content: r.content,
                score: r.score,
              })),
            },
            null,
            2,
          ),
        );
      } finally {
        engine.close();
      }
    },
  );
}
