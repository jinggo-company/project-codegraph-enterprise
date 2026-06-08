// Audit logging helper — backward-compatible wrapper around the new logAudit
import { prisma } from '@codegraph/db';

export interface AuditEntry {
  organizationId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      details: entry.details as any,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  });
}

/**
 * Re-export from the canonical audit module for direct import:
 *   import { logAudit } from '../audit/index.js';
 */
export { logAudit } from '../modules/audit/index.js';
