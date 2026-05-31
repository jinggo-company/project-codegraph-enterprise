// Webhook module — GitHub push events → auto index trigger
import { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@codegraph/db';
import { enqueueIndexJob } from '../../lib/scheduler.js';
import { tryAcquireForIndex } from '../../lib/concurrency.js';
import { createAuditLog } from '../../lib/audit.js';

/**
 * Verify GitHub webhook HMAC signature.
 */
function verifyGitHubSignature(payload: string, secret: string, signature: string): boolean {
  const hmac = createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'), 'utf8');
  const sigBuf = Buffer.from(signature, 'utf8');

  if (digest.length !== sigBuf.length) {
    return false;
  }

  return timingSafeEqual(digest, sigBuf);
}

/**
 * Extract repo info from GitHub webhook payload.
 */
function extractRepoInfo(body: any): { fullName: string; cloneUrl: string; branch: string } | null {
  const repository = body.repository;
  if (!repository) return null;

  const ref = body.ref || '';
  const branch = ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', '') : 'main';

  return {
    fullName: repository.full_name, // owner/repo
    cloneUrl: repository.clone_url,
    branch,
  };
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── GitHub Webhook ───
  app.post(
    '/api/webhooks/github',
    async (request: any, reply) => {
      const body = request.body;
      const event = request.headers['x-github-event'] as string;
      const signature = request.headers['x-hub-signature-256'] as string;
      const rawPayload = JSON.stringify(body);

      // HMAC verification (only if secret is configured)
      const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
      if (webhookSecret && signature) {
        const valid = verifyGitHubSignature(rawPayload, webhookSecret, signature);
        if (!valid) {
          return reply.code(401).send({
            code: 'UNAUTHORIZED',
            message: 'Invalid webhook signature',
          });
        }
      }

      // Only handle push events
      if (event !== 'push') {
        return reply.send({ message: 'Ignored non-push event' });
      }

      const repoInfo = extractRepoInfo(body);
      if (!repoInfo) {
        return reply.code(400).send({
          code: 'BAD_REQUEST',
          message: 'Missing repository info',
        });
      }

      // Find the project by git URL
      const project = await prisma.project.findFirst({
        where: {
          OR: [
            { gitUrl: repoInfo.cloneUrl },
            { gitUrl: `https://github.com/${repoInfo.fullName}` },
            { gitUrl: `git@github.com:${repoInfo.fullName}.git` },
          ],
          status: { not: 'DELETED' },
        },
        include: { team: { include: { organization: true } } },
      });

      if (!project) {
        return reply.send({ message: 'No project found for this repository' });
      }

      // Concurrency check — reject if already indexing
      const locked = await tryAcquireForIndex(project.id);
      if (!locked.allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: locked.reason,
        });
      }

      // Check for existing completed index (for incremental)
      const latestIndex = await prisma.index.findFirst({
        where: { projectId: project.id, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });

      // Determine job type
      const isIncremental = latestIndex !== null;

      const index = await prisma.index.create({
        data: {
          projectId: project.id,
          type: isIncremental ? 'INCREMENTAL' : 'FULL',
          status: 'QUEUED',
          triggerSource: 'WEBHOOK',
        },
      });

      // Update project status
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'INDEXING' },
      });

      // Changed files (from push payload)
      const changedFiles: string[] = (body.commits || [])
        .flatMap((c: any) => c.added || [])
        .concat((body.commits || []).flatMap((c: any) => c.modified || []))
        .filter(Boolean);

      // Enqueue job
      await enqueueIndexJob({
        projectId: project.id,
        type: isIncremental ? 'incremental' : 'full',
        triggerSource: 'webhook',
        gitUrl: project.gitUrl,
        branch: repoInfo.branch,
        changedFiles,
        previousIndexId: latestIndex?.id,
      });

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: 'system',
        action: 'index:webhook_triggered',
        entityType: 'index',
        entityId: index.id,
        details: {
          event,
          branch: repoInfo.branch,
          type: isIncremental ? 'incremental' : 'full',
          changedFilesCount: changedFiles.length,
        },
      });

      return reply.code(202).send({
        data: index,
        message: 'Webhook received, index queued',
      });
    }
  );

  // ─── GitLab Webhook ───
  app.post(
    '/api/webhooks/gitlab',
    async (request: any, reply) => {
      const body = request.body;
      const event = request.headers['x-gitlab-event'] as string;
      const token = request.headers['x-gitlab-token'] as string;

      // Secret token verification
      const gitlabToken = process.env.GITLAB_WEBHOOK_TOKEN;
      if (gitlabToken && token !== gitlabToken) {
        return reply.code(401).send({
          code: 'UNAUTHORIZED',
          message: 'Invalid GitLab webhook token',
        });
      }

      if (event !== 'Push Hook') {
        return reply.send({ message: 'Ignored non-push event' });
      }

      const project = await prisma.project.findFirst({
        where: {
          OR: [
            { gitUrl: body.project?.git_http_url || '' },
            { gitUrl: body.project?.git_ssh_url || '' },
          ],
          status: { not: 'DELETED' },
        },
        include: { team: { include: { organization: true } } },
      });

      if (!project) {
        return reply.send({ message: 'No project found for this repository' });
      }

      const locked = await tryAcquireForIndex(project.id);
      if (!locked.allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: locked.reason,
        });
      }

      const latestIndex = await prisma.index.findFirst({
        where: { projectId: project.id, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
      });

      const isIncremental = latestIndex !== null;

      const index = await prisma.index.create({
        data: {
          projectId: project.id,
          type: isIncremental ? 'INCREMENTAL' : 'FULL',
          status: 'QUEUED',
          triggerSource: 'WEBHOOK',
        },
      });

      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'INDEXING' },
      });

      await enqueueIndexJob({
        projectId: project.id,
        type: isIncremental ? 'incremental' : 'full',
        triggerSource: 'webhook',
        gitUrl: project.gitUrl,
        branch: body.ref?.replace('refs/heads/', '') || 'main',
        previousIndexId: latestIndex?.id,
      });

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: 'system',
        action: 'index:gitlab_webhook_triggered',
        entityType: 'index',
        entityId: index.id,
        details: { event, branch: body.ref },
      });

      return reply.code(202).send({
        data: index,
        message: 'GitLab webhook received, index queued',
      });
    }
  );

  // ─── Generic CI Webhook ───
  app.post(
    '/api/webhooks/ci',
    async (request: any, reply) => {
      const body = request.body;
      const schema = {
        projectId: body.projectId as string,
        triggerSource: body.triggerSource as string,
        branch: body.branch as string,
      };

      if (!schema.projectId) {
        return reply.code(400).send({
          code: 'BAD_REQUEST',
          message: 'projectId is required',
        });
      }

      const project = await prisma.project.findUnique({
        where: { id: schema.projectId },
        include: { team: { include: { organization: true } } },
      });

      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const locked = await tryAcquireForIndex(project.id);
      if (!locked.allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: locked.reason,
        });
      }

      const index = await prisma.index.create({
        data: {
          projectId: project.id,
          type: 'INCREMENTAL',
          status: 'QUEUED',
          triggerSource: 'WEBHOOK',
        },
      });

      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'INDEXING' },
      });

      await enqueueIndexJob({
        projectId: project.id,
        type: 'incremental',
        triggerSource: 'webhook',
        gitUrl: project.gitUrl,
        branch: schema.branch || project.branch,
      });

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: 'system',
        action: 'index:ci_webhook_triggered',
        entityType: 'index',
        entityId: index.id,
        details: { triggerSource: schema.triggerSource },
      });

      return reply.code(202).send({
        data: index,
        message: 'CI webhook received, index queued',
      });
    }
  );
}
