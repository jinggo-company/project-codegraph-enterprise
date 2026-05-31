/**
 * Audit Log Module — CodeGraph Enterprise
 *
 * Provides immutable, append-only audit logging for all critical operations.
 * Logs are read-only and cannot be tampered with (no UPDATE/DELETE endpoints).
 *
 * Routes:
 *   GET    /api/organizations/:orgId/audit-logs
 *
 * Internal (server-side only, no public endpoint):
 *   logAudit() — appends a new audit log entry
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@codegraph/db';
import { requireRole } from '../../plugins/rbac';

// ─── Types ────────────────────────────────────────────────────────────────

export type AuditAction =
  | 'CREATE_PROJECT'
  | 'DELETE_PROJECT'
  | 'UPDATE_PROJECT'
  | 'BUILD_INDEX'
  | 'SYNC_INDEX'
  | 'ADD_MEMBER'
  | 'REMOVE_MEMBER'
  | 'CHANGE_ROLE'
  | 'UPDATE_SUBSCRIPTION'
  | 'CREATE_API_KEY'
  | 'REVOKE_API_KEY'
  | 'LOGIN'
  | 'LOGOUT';

export interface AuditLogInput {
  userId: string;
  userName: string;
  action: AuditAction;
  resource: string;
  organizationId: string;
  ip?: string;
  details?: Record<string, unknown>;
}

// ─── Core function: append-only log entry ─────────────────────────────────

export async function logAudit(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      userName: input.userName,
      action: input.action,
      resource: input.resource,
      ip: input.ip ?? null,
      details: input.details ?? {},
    },
  });
}

// ─── Fastify module registration ──────────────────────────────────────────

export async function registerAuditModule(app: FastifyInstance) {
  // GET /api/organizations/:orgId/audit-logs
  app.get(
    '/api/organizations/:orgId/audit-logs',
    {
      preHandler: [requireRole(['owner', 'admin', 'developer', 'viewer'])],
      schema: {
        tags: ['audit'],
        summary: 'Query audit logs for an organization (read-only)',
        params: {
          type: 'object',
          properties: {
            orgId: { type: 'string' },
          },
          required: ['orgId'],
        },
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', default: 1 },
            limit: { type: 'integer', default: 50, maximum: 200 },
            action: { type: 'string' },
            userId: { type: 'string' },
            from: { type: 'string', format: 'date-time' },
            to: { type: 'string', format: 'date-time' },
          },
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userId: { type: 'string' },
                userName: { type: 'string' },
                action: { type: 'string' },
                resource: { type: 'string' },
                ip: { type: ['string', 'null'] },
                timestamp: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const { page = 1, limit = 50, action, userId, from, to } = request.query as Record<string, string | number>;

      const skip = ((page as number) - 1) * (limit as number);
      const take = Math.min(limit as number, 200);

      const where: Record<string, unknown> = { organizationId: orgId };
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (from || to) {
        where.createdAt = {};
        if (from) (where.createdAt as Record<string, string>).gte = from as string;
        if (to) (where.createdAt as Record<string, string>).lte = to as string;
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          userId: true,
          userName: true,
          action: true,
          resource: true,
          ip: true,
          createdAt: true,
        },
      });

      const total = await prisma.auditLog.count({ where });

      return reply.header('X-Total-Count', total).send(logs);
    },
  );

  // Explicitly: no PUT/PATCH/DELETE routes for audit logs — they are immutable
}
