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
