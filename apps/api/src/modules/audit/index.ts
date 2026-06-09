/**
 * Audit Log Module — CodeGraph Enterprise (F6)
 *
 * Provides immutable, append-only audit logging for all critical operations:
 *  - 构建记录: index 构建成功/失败/取消
 *  - 查询记录: MCP 查询、API 搜索
 *  - 操作日志: 成员管理、项目变更、订阅变更
 *  - 导出: CSV/JSON 格式的审计日志导出
 *
 * Logs are read-only and cannot be tampered with (no UPDATE/DELETE endpoints).
 *
 * Routes:
 *   GET    /api/organizations/:orgId/audit-logs          — 查询审计日志
 *   GET    /api/organizations/:orgId/audit-logs/export    — 导出审计日志（CSV/JSON）
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
  | 'BUILD_INDEX_COMPLETED'
  | 'BUILD_INDEX_FAILED'
  | 'BUILD_INDEX_CANCELLED'
  | 'SYNC_INDEX'
  | 'QUERY_CODE'
  | 'QUERY_SYMBOL'
  | 'QUERY_CALLERS'
  | 'QUERY_CALLEES'
  | 'QUERY_IMPACT'
  | 'QUERY_SEARCH'
  | 'ADD_MEMBER'
  | 'REMOVE_MEMBER'
  | 'CHANGE_ROLE'
  | 'UPDATE_SUBSCRIPTION'
  | 'CREATE_API_KEY'
  | 'REVOKE_API_KEY'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT_AUDIT_LOGS'
  | 'WEBHOOK_RECEIVED'
  | 'WEBHOOK_IGNORED'
  | 'WEBHOOK_REJECTED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_COMPLETED'
  | 'PLAN_UPGRADE'
  | 'PLAN_DOWNGRADE'
  | 'NOTIFICATION_SENT';

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

// ─── Export helpers ────────────────────────────────────────────────────────

/**
 * Escape a field value for CSV output.
 * Includes CSV injection prevention for values starting with = + - @
 * (see: https://owasp.org/www-community/attacks/CSV_Injection)
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // CSV injection prevention: values starting with = + - @ may execute formulas in spreadsheet apps
  if (/^[=+\-@]/.test(str)) {
    return `\t${str}`; // prefix with tab to neutralize
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert audit log entries to CSV format.
 */
function auditLogsToCsv(logs: Array<Record<string, unknown>>): string {
  const headers = ['id', 'userId', 'action', 'entityType', 'entityId', 'ipAddress', 'details', 'createdAt'];
  const rows = [headers.join(',')];
  for (const log of logs) {
    const row = headers.map(h => csvEscape(log[h]));
    rows.push(row.join(','));
  }
  return '\uFEFF' + rows.join('\n'); // UTF-8 BOM for Excel compatibility
}

// ─── Fastify module registration ──────────────────────────────────────────

export async function registerAuditModule(app: FastifyInstance) {
  // GET /api/organizations/:orgId/audit-logs
  app.get(
    '/api/organizations/:orgId/audit-logs',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const { page = 1, limit = 50, action, entityType, entityId, userId, from, to } =
        request.query as Record<string, string | number | undefined>;

      const skip = ((page as number) - 1) * (limit as number);
      const take = Math.min(limit as number, 200);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organizationId: orgId };
      if (action) where.action = action;
      if (entityType) where.entityType = entityType;
      if (entityId) where.entityId = entityId;
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
          userAgent: true,
          details: true,
          createdAt: true,
        },
      });

      const total = await prisma.auditLog.count({ where });

      return reply.header('X-Total-Count', total).send({
        data: logs,
        total,
        page: page as number,
        pageSize: take,
      });
    },
  );

  // GET /api/organizations/:orgId/audit-logs/export?format=csv|json&action=...&from=...&to=...
  app.get(
    '/api/organizations/:orgId/audit-logs/export',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const { format = 'csv', action, entityType, userId, from, to } =
        request.query as Record<string, string | undefined>;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organizationId: orgId };
      if (action) where.action = action;
      if (entityType) where.entityType = entityType;
      if (userId) where.userId = userId;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lte = to;
      }

      // Cap export at 10,000 records to prevent abuse
      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10_000,
        select: {
          id: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          ipAddress: true,
          userAgent: true,
          details: true,
          createdAt: true,
        },
      });

      // Record the export action itself
      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: 'EXPORT_AUDIT_LOGS',
        entityType: 'audit_log',
        organizationId: orgId,
        details: { format, recordCount: logs.length, filters: { action, entityType, userId, from, to } },
        ipAddress: request.ip,
      });

      if (format === 'json') {
        return reply
          .header('Content-Type', 'application/json')
          .header('Content-Disposition', `attachment; filename="audit-logs-${orgId}-${Date.now()}.json"`)
          .send(logs);
      }

      // Default: CSV
      const csv = auditLogsToCsv(logs.map(l => ({ ...l, details: l.details ? JSON.stringify(l.details) : '' })));
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="audit-logs-${orgId}-${Date.now()}.csv"`)
        .send(csv);
    },
  );

  // Explicitly: no PUT/PATCH/DELETE routes for audit logs — they are immutable
}
