// Webhook handlers for GitHub, GitLab, and CI integrations — F3
// Features: branch filtering, idempotency/deduplication, webhook config CRUD, event logging
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma, WebhookProvider, WebhookAction } from '@codegraph/db';
import { enqueueIndexJob } from '../../lib/scheduler.js';
import { createWebhookEventLog } from '../../lib/webhook-logger.js';
import { acquireProjectLock } from '../../lib/concurrency.js';

// ─── HMAC Verification ───────────────────────────────────────────────

function verifyGitHubSignature(payload: string, secret: string, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function verifyGitLabToken(token: string, secret: string): boolean {
  return token === secret;
}

// ─── Branch Filtering ────────────────────────────────────────────────

interface BranchFilterConfig {
  allow?: string[];
  deny?: string[];
}

function matchesBranch(branch: string, filter: BranchFilterConfig | null | undefined): boolean {
  if (!filter || (!filter.allow?.length && !filter.deny?.length)) {
    // No filter configured — allow all branches
    return true;
  }

  // Check deny list first (deny takes precedence)
  if (filter.deny?.length) {
    for (const pattern of filter.deny) {
      if (matchPattern(branch, pattern)) {
        return false;
      }
    }
  }

  // If allow list exists, branch must match at least one pattern
  if (filter.allow?.length) {
    for (const pattern of filter.allow) {
      if (matchPattern(branch, pattern)) {
        return true;
      }
    }
    return false;
  }

  // Only deny list, no allow list — allow if not denied
  return true;
}

/**
 * Simple glob-like pattern matching for branch names.
 * Supports: exact match, * wildcard, ** for any path segment.
 */
function matchPattern(branch: string, pattern: string): boolean {
  if (pattern === branch) return true;
  if (pattern === '*') return true;

  // Convert glob to regex
  const regex = pattern
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]+')
    .replace(/__DOUBLESTAR__/g, '.*');

  return new RegExp(`^${regex}$`).test(branch);
}

// ─── Idempotency / Deduplication ─────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function getRedis(): Promise<any> {
  // Lazy import to avoid startup dependency
  const { Redis } = await import('ioredis');
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

/**
 * Check if this webhook event is a duplicate within the dedup window.
 * dedupKey format: "webhook:dedup:<projectId>:<branch>:<commitSha>"
 * Returns true if duplicate (should be ignored).
 */
async function isDuplicateDedup(dedupKey: string, windowSec: number): Promise<boolean> {
  try {
    const redis = await getRedis();
    const exists = await redis.get(dedupKey);
    if (exists) {
      redis.quit();
      return true;
    }
    await redis.set(dedupKey, '1', 'EX', windowSec);
    redis.quit();
    return false;
  } catch {
    // Redis unavailable — fail open (process the event)
    return false;
  }
}

// ─── Resolve Project & Config ────────────────────────────────────────

async function resolveProjectAndConfig(gitUrl: string): Promise<{
  project: any;
  config: any | null;
} | null> {
  const project = await prisma.project.findFirst({
    where: { gitUrl, status: { not: 'DELETED' } },
    include: { team: { include: { organization: true } } },
  });

  if (!project) return null;

  // Find matching webhook config (prefer GitHub, then GitLab, then any enabled config)
  const configs = await prisma.webhookConfig.findMany({
    where: { projectId: project.id, enabled: true },
    orderBy: { createdAt: 'desc' },
  });

  return { project, config: configs.length > 0 ? configs[0] : null };
}

// ─── Webhook CRUD ────────────────────────────────────────────────────

export default async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── POST /api/webhooks/github — GitHub push webhook ───
  app.post('/api/webhooks/github', async (request: any, reply) => {
    const body = request.body;
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const signature = request.headers['x-hub-signature-256'] as string;
    const event = request.headers['x-github-event'] as string;
    const delivery = request.headers['x-github-delivery'] as string;

    // Parse payload
    const payload = typeof body === 'string' ? JSON.parse(body) : body;

    // Handle ping events
    if (event === 'ping') {
      return reply.code(200).send({ received: true, ping: true });
    }

    // Only handle push events
    if (event !== 'push') {
      return reply.code(200).send({ received: true, ignored: true, event });
    }

    const cloneUrl = payload.repository?.clone_url;
    if (!cloneUrl) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'No repository clone_url' });
    }

    const branch = payload.ref?.replace('refs/heads/', '') ?? '';
    const commitSha = payload.after ?? '';

    // Resolve project
    const resolved = await resolveProjectAndConfig(cloneUrl);
    if (!resolved) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
    }

    const { project, config } = resolved;

    // Verify HMAC signature if configured
    const secret = config?.secret ?? process.env.GITHUB_WEBHOOK_SECRET ?? '';
    if (secret && signature) {
      if (!verifyGitHubSignature(rawBody, secret, signature)) {
        await createWebhookEventLog({
          projectId: project.id,
          configId: config?.id ?? null,
          provider: 'GITHUB',
          event: 'push',
          action: 'REJECTED',
          reason: 'HMAC signature verification failed',
          branch,
          commit: commitSha,
          ip: (request as any).ip,
        });
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid signature' });
      }
    } else if (secret && !signature) {
      // Secret configured but no signature provided
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITHUB',
        event: 'push',
        action: 'REJECTED',
        reason: 'Missing HMAC signature',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Missing signature' });
    }

    // Branch filtering
    const branchFilter = config?.branchFilter as BranchFilterConfig | null;
    if (!matchesBranch(branch, branchFilter)) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITHUB',
        event: 'push',
        action: 'IGNORED',
        reason: `Branch '${branch}' not in filter allow-list`,
        branch,
        commit: commitSha,
        rawPayload: { ref: payload.ref, repository: payload.repository?.full_name },
        ip: (request as any).ip,
      });
      return reply.code(200).send({ received: true, ignored: true, reason: `branch '${branch}' filtered out` });
    }

    // Idempotency deduplication
    const dedupKey = `webhook:dedup:${project.id}:${branch}:${commitSha}`;
    const dedupWindow = config?.dedupWindowSec ?? 60;
    if (await isDuplicateDedup(dedupKey, dedupWindow)) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITHUB',
        event: 'push',
        dedupKey,
        action: 'IGNORED',
        reason: 'Duplicate event (within dedup window)',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(200).send({ received: true, ignored: true, reason: 'duplicate event' });
    }

    // Check concurrency lock
    const locked = await acquireProjectLock(project.id);
    if (!locked) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITHUB',
        event: 'push',
        action: 'IGNORED',
        reason: 'Project currently indexing (concurrency lock)',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(202).send({ received: true, queued: false, reason: 'project currently indexing' });
    }

    // Create index record
    const indexType = config?.indexType ?? 'INCREMENTAL';
    const priority = config?.priority ?? 3;

    const index = await prisma.index.create({
      data: {
        projectId: project.id,
        type: indexType,
        status: 'QUEUED',
        triggerSource: 'WEBHOOK',
      },
    });

    const job = await prisma.indexJob.create({
      data: {
        projectId: project.id,
        indexId: index.id,
        type: indexType,
        trigger: 'WEBHOOK',
        priority,
      },
    });

    try {
      await enqueueIndexJob(job);
    } catch (err: any) {
      // Release lock on enqueue failure
      const { releaseProjectLock } = await import('../../lib/concurrency.js');
      await releaseProjectLock(project.id);

      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITHUB',
        event: 'push',
        dedupKey,
        action: 'ERROR',
        reason: `Failed to enqueue job: ${err?.message ?? 'unknown'}`,
        branch,
        commit: commitSha,
        indexId: index.id,
        jobId: job.id,
        ip: (request as any).ip,
      });
      return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to enqueue index job' });
    }

    await createWebhookEventLog({
      projectId: project.id,
      configId: config?.id ?? null,
      provider: 'GITHUB',
      event: 'push',
      dedupKey,
      action: 'QUEUED',
      branch,
      commit: commitSha,
      indexId: index.id,
      jobId: job.id,
      ip: (request as any).ip,
    });

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
      branch,
      commit: commitSha,
    });
  });

  // ─── POST /api/webhooks/gitlab — GitLab push webhook ───
  app.post('/api/webhooks/gitlab', async (request: any, reply) => {
    const body = request.body;
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const token = request.headers['x-gitlab-token'] as string;
    const event = request.headers['x-gitlab-event'] as string;

    const payload = typeof body === 'string' ? JSON.parse(body) : body;

    if (event !== 'Push Hook' && event !== 'push') {
      return reply.code(200).send({ received: true, ignored: true, event });
    }

    const gitHttpUrl = payload.project?.git_http_url ?? payload.project?.web_url;
    if (!gitHttpUrl) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'No project URL' });
    }

    const branch = payload.ref?.replace('refs/heads/', '') ?? '';
    const commitSha = payload.after ?? payload.checkout_sha ?? '';

    // Resolve project
    const resolved = await resolveProjectAndConfig(gitHttpUrl);
    if (!resolved) {
      // Try alternate URL format (https vs ssh)
      const altUrl = gitHttpUrl.replace(/^https?:\/\//, 'https://').replace(/\.git$/, '');
      const resolvedAlt = await resolveProjectAndConfig(altUrl);
      if (!resolvedAlt) {
        return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
      }
      Object.assign(resolved, resolvedAlt);
    }

    const { project, config } = resolved;

    // Verify token
    const secret = config?.secret ?? process.env.GITLAB_WEBHOOK_SECRET ?? '';
    if (secret && token) {
      if (!verifyGitLabToken(token, secret)) {
        await createWebhookEventLog({
          projectId: project.id,
          configId: config?.id ?? null,
          provider: 'GITLAB',
          event: 'push',
          action: 'REJECTED',
          reason: 'GitLab token verification failed',
          branch,
          commit: commitSha,
          ip: (request as any).ip,
        });
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid token' });
      }
    } else if (secret && !token) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITLAB',
        event: 'push',
        action: 'REJECTED',
        reason: 'Missing GitLab token',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Missing token' });
    }

    // Branch filtering
    const branchFilter = config?.branchFilter as BranchFilterConfig | null;
    if (!matchesBranch(branch, branchFilter)) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITLAB',
        event: 'push',
        action: 'IGNORED',
        reason: `Branch '${branch}' not in filter allow-list`,
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(200).send({ received: true, ignored: true, reason: `branch '${branch}' filtered out` });
    }

    // Idempotency deduplication
    const dedupKey = `webhook:dedup:${project.id}:${branch}:${commitSha}`;
    const dedupWindow = config?.dedupWindowSec ?? 60;
    if (await isDuplicateDedup(dedupKey, dedupWindow)) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITLAB',
        event: 'push',
        dedupKey,
        action: 'IGNORED',
        reason: 'Duplicate event (within dedup window)',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(200).send({ received: true, ignored: true, reason: 'duplicate event' });
    }

    // Concurrency lock
    const locked = await acquireProjectLock(project.id);
    if (!locked) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITLAB',
        event: 'push',
        action: 'IGNORED',
        reason: 'Project currently indexing (concurrency lock)',
        branch,
        commit: commitSha,
        ip: (request as any).ip,
      });
      return reply.code(202).send({ received: true, queued: false, reason: 'project currently indexing' });
    }

    // Create index record
    const indexType = config?.indexType ?? 'INCREMENTAL';
    const priority = config?.priority ?? 3;

    const index = await prisma.index.create({
      data: {
        projectId: project.id,
        type: indexType,
        status: 'QUEUED',
        triggerSource: 'WEBHOOK',
      },
    });

    const job = await prisma.indexJob.create({
      data: {
        projectId: project.id,
        indexId: index.id,
        type: indexType,
        trigger: 'WEBHOOK',
        priority,
      },
    });

    try {
      await enqueueIndexJob(job);
    } catch (err: any) {
      const { releaseProjectLock } = await import('../../lib/concurrency.js');
      await releaseProjectLock(project.id);

      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'GITLAB',
        event: 'push',
        dedupKey,
        action: 'ERROR',
        reason: `Failed to enqueue job: ${err?.message ?? 'unknown'}`,
        branch,
        commit: commitSha,
        indexId: index.id,
        jobId: job.id,
        ip: (request as any).ip,
      });
      return reply.code(500).send({ code: 'INTERNAL_ERROR', message: 'Failed to enqueue index job' });
    }

    await createWebhookEventLog({
      projectId: project.id,
      configId: config?.id ?? null,
      provider: 'GITLAB',
      event: 'push',
      dedupKey,
      action: 'QUEUED',
      branch,
      commit: commitSha,
      indexId: index.id,
      jobId: job.id,
      ip: (request as any).ip,
    });

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
      branch,
      commit: commitSha,
    });
  });

  // ─── POST /api/webhooks/ci — Generic CI webhook (Jenkins, CircleCI, etc.) ───
  app.post('/api/webhooks/ci', async (request: any, reply) => {
    const body = request.body;
    const payload = typeof body === 'string' ? JSON.parse(body) : body;

    const { projectId, buildStatus, gitUrl } = payload;

    if (!gitUrl) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Missing gitUrl' });
    }

    if (buildStatus !== 'success') {
      return reply.code(200).send({
        received: true,
        ignored: true,
        reason: `build status: ${buildStatus}`,
      });
    }

    // Find project by projectId or gitUrl
    let project: any = null;
    if (projectId) {
      project = await prisma.project.findFirst({
        where: { id: projectId, status: { not: 'DELETED' } },
        include: { team: { include: { organization: true } } },
      });
    }
    if (!project) {
      project = await prisma.project.findFirst({
        where: { gitUrl, status: { not: 'DELETED' } },
        include: { team: { include: { organization: true } } },
      });
    }

    if (!project) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
    }

    // Check webhook config for branch filtering
    const configs = await prisma.webhookConfig.findMany({
      where: { projectId: project.id, provider: 'CI', enabled: true },
      orderBy: { createdAt: 'desc' },
    });

    const config = configs.length > 0 ? configs[0] : null;
    const branch = payload.branch ?? project.branch;
    const branchFilter = config?.branchFilter as BranchFilterConfig | null;
    if (!matchesBranch(branch, branchFilter)) {
      await createWebhookEventLog({
        projectId: project.id,
        configId: config?.id ?? null,
        provider: 'CI',
        event: 'build_success',
        action: 'IGNORED',
        reason: `Branch '${branch}' not in filter allow-list`,
        branch,
        ip: (request as any).ip,
      });
      return reply.code(200).send({ received: true, ignored: true, reason: `branch '${branch}' filtered out` });
    }

    // Concurrency lock
    const locked = await acquireProjectLock(project.id);
    if (!locked) {
      return reply.code(202).send({ received: true, queued: false, reason: 'project currently indexing' });
    }

    const index = await prisma.index.create({
      data: {
        projectId: project.id,
        type: 'INCREMENTAL',
        status: 'QUEUED',
        triggerSource: 'WEBHOOK',
      },
    });

    const job = await prisma.indexJob.create({
      data: {
        projectId: project.id,
        indexId: index.id,
        type: 'INCREMENTAL',
        trigger: 'WEBHOOK',
        priority: 2,
      },
    });

    await enqueueIndexJob(job);

    await createWebhookEventLog({
      projectId: project.id,
      configId: config?.id ?? null,
      provider: 'CI',
      event: 'build_success',
      action: 'QUEUED',
      branch,
      indexId: index.id,
      jobId: job.id,
      ip: (request as any).ip,
    });

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
    });
  });

  // ─── Webhook Config CRUD ───────────────────────────────────────────

  // List webhook configs for a project
  app.get(
    '/api/projects/:projectId/webhook-configs',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      const project = await prisma.project.findFirst({
        where: { id: projectId },
        include: { team: { include: { organization: true } } },
      });
      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: project.teamId },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const configs = await prisma.webhookConfig.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });

      // Mask secrets in response
      const masked = configs.map((c: any) => ({
        ...c,
        secret: c.secret ? '••••••••' : null,
      }));

      return reply.send({ data: masked });
    }
  );

  // Create webhook config
  app.post(
    '/api/projects/:projectId/webhook-configs',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;
      const schema = z.object({
        provider: z.enum(['GITHUB', 'GITLAB', 'CI']),
        secret: z.string().max(255).optional(),
        enabled: z.boolean().default(true),
        branchFilter: z.object({
          allow: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        }).optional(),
        indexType: z.enum(['FULL', 'INCREMENTAL']).default('INCREMENTAL'),
        priority: z.number().int().min(0).max(10).default(3),
        dedupWindowSec: z.number().int().min(0).max(3600).default(60),
      });
      const body = schema.parse(request.body);

      const project = await prisma.project.findFirst({
        where: { id: projectId },
        include: { team: true },
      });
      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: project.teamId },
      });
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
      }

      const config = await prisma.webhookConfig.create({
        data: {
          projectId,
          provider: body.provider as WebhookProvider,
          secret: body.secret ?? null,
          enabled: body.enabled,
          branchFilter: body.branchFilter ?? null,
          indexType: body.indexType as any,
          priority: body.priority,
          dedupWindowSec: body.dedupWindowSec,
        },
      });

      const { createAuditLog } = await import('../../lib/audit.js');
      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: request.userId,
        action: 'webhook_config:created',
        entityType: 'webhook_config',
        entityId: config.id,
        details: { provider: body.provider, branchFilter: body.branchFilter },
        ipAddress: (request as any).ip,
      });

      return reply.code(201).send({ data: { ...config, secret: '••••••••' } });
    }
  );

  // Update webhook config
  app.patch(
    '/api/projects/:projectId/webhook-configs/:configId',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId, configId } = request.params;
      const schema = z.object({
        secret: z.string().max(255).optional(),
        enabled: z.boolean().optional(),
        branchFilter: z.object({
          allow: z.array(z.string()).optional(),
          deny: z.array(z.string()).optional(),
        }).optional(),
        indexType: z.enum(['FULL', 'INCREMENTAL']).optional(),
        priority: z.number().int().min(0).max(10).optional(),
        dedupWindowSec: z.number().int().min(0).max(3600).optional(),
      });
      const body = schema.parse(request.body);

      const config = await prisma.webhookConfig.findFirst({
        where: { id: configId, projectId },
        include: { project: { include: { team: true } } },
      });
      if (!config) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Webhook config not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: config.project.teamId },
      });
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
      }

      const updated = await prisma.webhookConfig.update({
        where: { id: configId },
        data: body,
      });

      const { createAuditLog } = await import('../../lib/audit.js');
      await createAuditLog({
        organizationId: config.project.team.organizationId,
        userId: request.userId,
        action: 'webhook_config:updated',
        entityType: 'webhook_config',
        entityId: configId,
        details: body,
        ipAddress: (request as any).ip,
      });

      return reply.send({ data: { ...updated, secret: updated.secret ? '••••••••' : null } });
    }
  );

  // Delete webhook config
  app.delete(
    '/api/projects/:projectId/webhook-configs/:configId',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId, configId } = request.params;

      const config = await prisma.webhookConfig.findFirst({
        where: { id: configId, projectId },
        include: { project: { include: { team: true } } },
      });
      if (!config) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Webhook config not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: config.project.teamId },
      });
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
      }

      await prisma.webhookConfig.delete({ where: { id: configId } });

      const { createAuditLog } = await import('../../lib/audit.js');
      await createAuditLog({
        organizationId: config.project.team.organizationId,
        userId: request.userId,
        action: 'webhook_config:deleted',
        entityType: 'webhook_config',
        entityId: configId,
        ipAddress: (request as any).ip,
      });

      return reply.code(204).send();
    }
  );

  // ─── Webhook Event Logs ────────────────────────────────────────────

  // GET /api/projects/:projectId/webhook-events — list webhook event logs
  app.get(
    '/api/projects/:projectId/webhook-events',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;
      const { action, page = '1', limit = '20' } = request.query as Record<string, string>;

      const project = await prisma.project.findFirst({
        where: { id: projectId },
        include: { team: { include: { organization: true } } },
      });
      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: project.teamId },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const where: Record<string, unknown> = { projectId };
      if (action) where.action = action.toUpperCase();

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [events, total] = await Promise.all([
        prisma.webhookEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
        prisma.webhookEvent.count({ where }),
      ]);

      return reply.send({ data: events, total, page: pageNum, limit: limitNum });
    }
  );

  // GET /api/indexes/:indexId/webhook-events — get webhook events for a specific index
  app.get(
    '/api/indexes/:indexId/webhook-events',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findFirst({
        where: { id: indexId },
        include: { project: { include: { team: true } } },
      });
      if (!index) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: index.project.teamId },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const events = await prisma.webhookEvent.findMany({
        where: { indexId },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({ data: events });
    }
  );
}
