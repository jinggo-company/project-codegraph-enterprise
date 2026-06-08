// Webhook event logging for F3 — CI/CD auto-index build traceability
import { prisma, WebhookProvider, WebhookAction } from '@codegraph/db';

export interface WebhookEventEntry {
  projectId: string | null;
  configId: string | null;
  provider: WebhookProvider;
  event: string;
  action: WebhookAction;
  reason?: string;
  branch?: string;
  commit?: string;
  dedupKey?: string;
  indexId?: string;
  jobId?: string;
  rawPayload?: Record<string, unknown>;
  ip?: string;
}

/**
 * Create a webhook event log entry.
 * Always succeeds silently — logging failure should not break webhook processing.
 */
export async function createWebhookEventLog(entry: WebhookEventEntry): Promise<void> {
  try {
    await prisma.webhookEvent.create({
      data: {
        projectId: entry.projectId ?? undefined,
        configId: entry.configId ?? undefined,
        provider: entry.provider as any,
        event: entry.event,
        action: entry.action as any,
        reason: entry.reason ?? null,
        branch: entry.branch ?? null,
        commit: entry.commit ?? null,
        dedupKey: entry.dedupKey ?? null,
        indexId: entry.indexId ?? undefined,
        jobId: entry.jobId ?? undefined,
        rawPayload: (entry.rawPayload as any) ?? null,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    // Log to console but don't throw — webhook processing must continue
    console.error('[webhook-logger] Failed to create event log:', err);
  }
}

/**
 * Map WebhookAction → AuditAction for parallel audit logging.
 */
function webhookActionToAudit(action: WebhookAction): string {
  switch (action) {
    case 'QUEUED': return 'BUILD_INDEX';
    case 'IGNORED': return 'WEBHOOK_IGNORED';
    case 'REJECTED': return 'WEBHOOK_REJECTED';
    case 'ERROR': return 'BUILD_INDEX_FAILED';
    default: return 'BUILD_INDEX';
  }
}

/**
 * Create a webhook event log AND write a corresponding audit log entry
 * so that F6 audit queries also cover webhook events.
 */
export async function createWebhookEventLogWithAudit(
  entry: WebhookEventEntry & { organizationId?: string; userId?: string },
): Promise<void> {
  await createWebhookEventLog(entry);

  if (!entry.organizationId) return;

  try {
    await prisma.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId ?? 'system',
        action: webhookActionToAudit(entry.action as any),
        entityType: 'webhook',
        entityId: entry.indexId ?? entry.projectId ?? undefined,
        ipAddress: entry.ip,
        details: {
          provider: entry.provider,
          event: entry.event,
          action: entry.action,
          branch: entry.branch,
          commit: entry.commit,
          reason: entry.reason,
        },
      },
    });
  } catch {
    // Audit write failure should not break webhook processing
  }
}
