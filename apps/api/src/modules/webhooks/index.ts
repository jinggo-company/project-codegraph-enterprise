// Webhook handlers for GitHub, GitLab, and CI integrations
import { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '@codegraph/db';
import { enqueueIndexJob } from '../../lib/scheduler.js';

// ─── HMAC Verification ───────────────────────────────────────────────

function verifyGitHubSignature(payload: string, secret: string, signature: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function verifyGitLabToken(token: string, secret: string): boolean {
  return token === secret;
}

// ─── Webhook Routes ──────────────────────────────────────────────────

export default async function webhookRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── POST /api/webhooks/github — GitHub push/deploy webhook ───
  app.post('/api/webhooks/github', async (request: any, reply) => {
    const body = request.body;
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const signature = request.headers['x-hub-signature-256'] as string;
    const event = request.headers['x-github-event'] as string;
    const secret = process.env.GITHUB_WEBHOOK_SECRET ?? '';

    // Verify signature
    if (secret && signature) {
      if (!verifyGitHubSignature(rawBody, secret, signature)) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid signature' });
      }
    }

    // Handle push events
    if (event !== 'push') {
      return reply.code(200).send({ received: true, ignored: true, event });
    }

    const payload = typeof body === 'string' ? JSON.parse(body) : body;
    const cloneUrl = payload.repository?.clone_url;

    if (!cloneUrl) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'No repository clone_url' });
    }

    // Find matching project
    const project = await prisma.project.findFirst({
      where: { gitUrl: cloneUrl, status: { not: 'DELETED' } },
    });

    if (!project) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
    }

    // Create index record
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
        priority: 3,
      },
    });

    await enqueueIndexJob(job);

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
    });
  });

  // ─── POST /api/webhooks/gitlab — GitLab push webhook ───
  app.post('/api/webhooks/gitlab', async (request: any, reply) => {
    const body = request.body;
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
    const token = request.headers['x-gitlab-token'] as string;
    const event = request.headers['x-gitlab-event'] as string;
    const secret = process.env.GITLAB_WEBHOOK_SECRET ?? '';

    if (secret && token) {
      if (!verifyGitLabToken(token, secret)) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid token' });
      }
    }

    if (event !== 'Push Hook') {
      return reply.code(200).send({ received: true, ignored: true, event });
    }

    const payload = typeof body === 'string' ? JSON.parse(body) : body;
    const gitHttpUrl = payload.project?.git_http_url;

    if (!gitHttpUrl) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'No project URL' });
    }

    const project = await prisma.project.findFirst({
      where: { gitUrl: gitHttpUrl, status: { not: 'DELETED' } },
    });

    if (!project) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
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
        priority: 3,
      },
    });

    await enqueueIndexJob(job);

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
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
    let project = null;
    if (projectId) {
      project = await prisma.project.findFirst({
        where: { id: projectId, status: { not: 'DELETED' } },
      });
    }
    if (!project) {
      project = await prisma.project.findFirst({
        where: { gitUrl, status: { not: 'DELETED' } },
      });
    }

    if (!project) {
      return reply.code(200).send({ received: true, ignored: true, reason: 'no matching project' });
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

    return reply.code(202).send({
      indexId: index.id,
      jobId: job.id,
      status: 'QUEUED',
    });
  });
}
