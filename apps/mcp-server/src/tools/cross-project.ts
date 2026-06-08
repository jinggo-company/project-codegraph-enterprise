/**
 * Cross-project search MCP tools (F5).
 *
 * These tools search across all indexed projects for an organization,
 * rather than limiting to a single project.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CrossProjectEngine } from '../index-engine/cross-project.js';
import { isAuthRequired, validateApiKey, extractApiKey } from '../middleware/auth.js';

function withAuth(apiKey: string, headers: Record<string, string> | undefined): { error: string } | null {
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

// ─── Tool: search_across_projects ───────────────────────────────────────

export function registerSearchAcrossProjects(
  server: McpServer,
  engine: CrossProjectEngine,
  apiKey: string,
) {
  server.tool(
    'search_across_projects',
    'Search for code symbols across all indexed projects in your organization. Returns matching symbols from every project, tagged with their source project identifier.',
    {
      query: z.string().describe('Search query (symbol name, partial match, or keyword)'),
      projectIds: z.array(z.string()).describe('List of project IDs to search across'),
      language: z.string().optional().describe('Filter by language (e.g., typescript, python, go)'),
      limit: z.number().optional().describe('Maximum results per project (default 50)'),
    },
    async ({ query, projectIds, language, limit }, extra) => {
      const authError = withAuth(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (projectIds.length === 0) {
        return makeTextResult(JSON.stringify({ error: 'projectIds must not be empty' }));
      }

      try {
        const results = await engine.searchAcrossProjects(query, projectIds, {
          language,
          limit,
        });
        return makeTextResult(
          JSON.stringify(
            {
              query,
              projectsSearched: projectIds.length,
              totalResults: results.length,
              results: results.map((r) => ({
                project: r.project,
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
      } catch (err: any) {
        return makeTextResult(JSON.stringify({ error: err.message }));
      }
    },
  );
}

// ─── Tool: search_symbol_across_projects ────────────────────────────────

export function registerSearchSymbolAcrossProjects(
  server: McpServer,
  engine: CrossProjectEngine,
  apiKey: string,
) {
  server.tool(
    'search_symbol_across_projects',
    'Search for a specific symbol definition across all indexed projects. Returns all occurrences of the named symbol with their location and signature.',
    {
      name: z.string().describe('Exact symbol name to search for'),
      projectIds: z.array(z.string()).describe('List of project IDs to search across'),
      kind: z.string().optional().describe('Filter by symbol kind (function, class, interface, etc.)'),
    },
    async ({ name, projectIds, kind }, extra) => {
      const authError = withAuth(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (projectIds.length === 0) {
        return makeTextResult(JSON.stringify({ error: 'projectIds must not be empty' }));
      }

      try {
        const results = await engine.searchSymbolAcrossProjects(name, projectIds, { language: kind });
        return makeTextResult(
          JSON.stringify(
            {
              name,
              kind,
              projectsSearched: projectIds.length,
              totalResults: results.length,
              symbols: results.map((r) => ({
                project: r.project,
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
      } catch (err: any) {
        return makeTextResult(JSON.stringify({ error: err.message }));
      }
    },
  );
}

// ─── Tool: search_callers_across_projects ───────────────────────────────

export function registerSearchCallersAcrossProjects(
  server: McpServer,
  engine: CrossProjectEngine,
  apiKey: string,
) {
  server.tool(
    'search_callers_across_projects',
    'Find all callers of a given symbol across multiple indexed projects. Useful for understanding how a function is used throughout the organization.',
    {
      name: z.string().describe('Symbol name to find callers for'),
      projectIds: z.array(z.string()).describe('List of project IDs to search across'),
    },
    async ({ name, projectIds }, extra) => {
      const authError = withAuth(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (projectIds.length === 0) {
        return makeTextResult(JSON.stringify({ error: 'projectIds must not be empty' }));
      }

      try {
        const results = await engine.searchCallersAcrossProjects(name, projectIds);
        return makeTextResult(
          JSON.stringify(
            {
              name,
              projectsSearched: projectIds.length,
              totalResults: results.length,
              callers: results.map((r) => ({
                project: r.project,
                caller: r.caller,
                callerFile: r.callerFile,
                callerLine: r.callerLine,
                callee: r.callee,
                calleeFile: r.calleeFile,
                calleeLine: r.calleeLine,
              })),
            },
            null,
            2,
          ),
        );
      } catch (err: any) {
        return makeTextResult(JSON.stringify({ error: err.message }));
      }
    },
  );
}

// ─── Tool: search_fulltext_across_projects ──────────────────────────────

export function registerSearchFulltextAcrossProjects(
  server: McpServer,
  engine: CrossProjectEngine,
  apiKey: string,
) {
  server.tool(
    'search_fulltext_across_projects',
    'Full-text search across all indexed projects using SQLite FTS5. Returns matching code snippets from every project, tagged with their source project.',
    {
      query: z.string().describe('Full-text search query'),
      projectIds: z.array(z.string()).describe('List of project IDs to search across'),
      limit: z.number().optional().describe('Maximum results per project (default 50)'),
    },
    async ({ query, projectIds, limit }, extra) => {
      const authError = withAuth(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (projectIds.length === 0) {
        return makeTextResult(JSON.stringify({ error: 'projectIds must not be empty' }));
      }

      try {
        const results = await engine.searchFulltextAcrossProjects(query, projectIds, { limit });
        return makeTextResult(
          JSON.stringify(
            {
              query,
              projectsSearched: projectIds.length,
              totalResults: results.length,
              results: results.map((r) => ({
                project: r.project,
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
      } catch (err: any) {
        return makeTextResult(JSON.stringify({ error: err.message }));
      }
    },
  );
}

// ─── Tool: search_routes_across_projects ────────────────────────────────

export function registerSearchRoutesAcrossProjects(
  server: McpServer,
  engine: CrossProjectEngine,
  apiKey: string,
) {
  server.tool(
    'search_routes_across_projects',
    'Search for web framework routes across multiple indexed projects. Returns route→handler mappings from all projects.',
    {
      urlPattern: z.string().optional().describe('URL pattern to match (e.g., /api/users)'),
      framework: z.string().optional().describe('Filter by framework (express, fastify, spring, etc.)'),
      projectIds: z.array(z.string()).describe('List of project IDs to search across'),
    },
    async ({ urlPattern, framework, projectIds }, extra) => {
      const authError = withAuth(apiKey, extra?._meta as Record<string, string> | undefined);
      if (authError) return makeTextResult(JSON.stringify({ error: authError.error }));

      if (projectIds.length === 0) {
        return makeTextResult(JSON.stringify({ error: 'projectIds must not be empty' }));
      }

      try {
        const results = await engine.searchRoutesAcrossProjects(projectIds, { urlPattern, framework });
        return makeTextResult(
          JSON.stringify(
            {
              urlPattern,
              framework,
              projectsSearched: projectIds.length,
              totalResults: results.length,
              routes: results.map((r) => ({
                project: r.project,
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
      } catch (err: any) {
        return makeTextResult(JSON.stringify({ error: err.message }));
      }
    },
  );
}
