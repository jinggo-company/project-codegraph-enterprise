/**
 * Cross-Project Search API module (F5).
 *
 * GET /api/organizations/:orgId/search — search across all indexed projects
 *   for an organization, returning aggregated results from every project.
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { createAuditLog } from '../../lib/audit.js';
import { CrossProjectEngine } from '../../../../mcp-server/src/index-engine/cross-project.js';

const INDEX_DIR = process.env.CODEGRAPH_INDEX_DIR ?? './data/indexes';

export default async function searchRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── Cross-Project Search ───
  app.get('/api/organizations/:orgId/search', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;

    // Verify membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied: not a member' });
    }

    const querySchema = z.object({
      q: z.string().min(1).describe('Search query (symbol name, partial match, or keyword)'),
      type: z.enum(['symbol', 'fulltext', 'caller', 'route']).optional().default('symbol'),
      projectIds: z.string().optional().describe('Comma-separated project IDs to filter'),
      language: z.string().optional().describe('Filter by language'),
      limit: z.coerce.number().int().positive().default(50).describe('Max results per project'),
    });

    const query = querySchema.parse(request.query);

    // Get all projects for this org
    const projects = await prisma.project.findMany({
      where: {
        team: { organizationId: orgId },
        status: { not: 'DELETED' },
      },
      select: { id: true, name: true },
    });

    if (projects.length === 0) {
      return reply.send({ data: { projectsSearched: 0, totalResults: 0, results: [] } });
    }

    // Filter by projectIds if provided
    let targetProjectIds = projects.map((p) => p.id);
    if (query.projectIds) {
      const requestedIds = query.projectIds.split(',').map((s) => s.trim());
      targetProjectIds = targetProjectIds.filter((id) => requestedIds.includes(id));
    }

    const engine = new CrossProjectEngine(INDEX_DIR);

    let results: any[] = [];

    switch (query.type) {
      case 'symbol':
        results = engine.searchAcrossProjects(query.q, targetProjectIds, {
          language: query.language,
          limit: query.limit,
        }).map((r) => ({
          project: r.project,
          file: r.file,
          line: r.line,
          column: r.column,
          symbol: r.symbol,
          kind: r.kind,
          snippet: r.snippet,
        }));
        break;

      case 'fulltext':
        results = engine.searchFulltextAcrossProjects(query.q, targetProjectIds, {
          limit: query.limit,
        }).map((r) => ({
          project: r.project,
          file: r.file,
          line: r.line,
          content: r.content,
          score: r.score,
        }));
        break;

      case 'caller':
        results = engine.searchCallersAcrossProjects(query.q, targetProjectIds).map((r) => ({
          project: r.project,
          caller: r.caller,
          callerFile: r.callerFile,
          callerLine: r.callerLine,
          callee: r.callee,
          calleeFile: r.calleeFile,
          calleeLine: r.calleeLine,
        }));
        break;

      case 'route':
        results = engine.searchRoutesAcrossProjects(targetProjectIds, {
          urlPattern: query.q,
          framework: query.language,
        }).map((r) => ({
          project: r.project,
          method: r.method,
          path: r.path,
          handler: r.handler,
          file: r.file,
          framework: r.framework,
        }));
        break;
    }

    // Log the search
    await createAuditLog({
      organizationId: orgId,
      userId: request.userId,
      action: 'search:cross_project',
      entityType: 'search',
      entityId: null,
      details: { query: query.q, type: query.type, projectCount: targetProjectIds.length, resultCount: results.length },
      ipAddress: (request as any).ip,
    });

    return reply.send({
      data: {
        query: query.q,
        type: query.type,
        projectsSearched: targetProjectIds.length,
        totalResults: results.length,
        results,
      },
    });
  });
}
