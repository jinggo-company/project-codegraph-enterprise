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

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codegraph/db';

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
  action: AuditAction;
  entityType: string;
  entityId?: string;
  organizationId: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

// ─── Core function: append-only log entry ─────────────────────────────────

export async function logAudit(input: AuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      details: input.details ? JSON.parse(JSON.stringify(input.details)) : null,
    },
  });
}

// ─── Fastify module registration ──────────────────────────────────────────

export async function registerAuditModule(app: FastifyInstance) {
  // GET /api/organizations/:orgId/audit-logs
  app.get(
    '/api/organizations/:orgId/audit-logs',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const { page = 1, limit = 50, action, userId, from, to } = request.query as Record<string, string | number>;

      const skip = ((page as number) - 1) * (limit as number);
      const take = Math.min(limit as number, 200);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organizationId: orgId };
      if (action) where.action = action;
      if (userId) where.userId = userId;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lte = to;
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          ipAddress: true,
          createdAt: true,
        },
      });

      const total = await prisma.auditLog.count({ where });

      return reply.header('X-Total-Count', total).send(logs);
    },
  );

  // Explicitly: no PUT/PATCH/DELETE routes for audit logs — they are immutable
}
