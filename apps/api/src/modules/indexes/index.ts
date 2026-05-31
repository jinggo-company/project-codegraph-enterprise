// Index Scheduler REST API — T-2026-00133
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { createAuditLog } from '../../lib/audit.js';
import {
  enqueueIndexJob,
  getQueueStats,
  cancelJob,
} from '../../lib/scheduler.js';
import { acquireProjectLock, releaseProjectLock, checkRateLimit } from '../../lib/concurrency.js';

export default async function indexRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── POST /api/projects/:projectId/indexes/build — Trigger full/incremental index ───
  app.post(
    '/api/projects/:projectId/indexes/build',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;
      const schema = z.object({
        type: z.enum(['FULL', 'INCREMENTAL', 'CLEANUP']).default('FULL'),
        trigger: z.enum(['WEBHOOK', 'MANUAL', 'WATCHER', 'SCHEDULE']).default('MANUAL'),
        priority: z.number().int().min(0).max(10).default(0),
      });
      const body = schema.parse(request.body);

      // Verify project access
      const project = await prisma.project.findFirst({
        where: { id: projectId },
        include: { team: { include: { organization: true } } },
      });
      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, team: { organizationId: project.team.organizationId } },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
      }

      // Rate limit check
      const allowed = await checkRateLimit(projectId);
      if (!allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded. Try again later.',
        });
      }

      // Create index record
      const index = await prisma.index.create({
        data: {
          projectId,
          type: body.type,
          status: 'QUEUED',
          triggerSource: body.trigger,
        },
      });

      // Create scheduling job
      const job = await prisma.indexJob.create({
        data: {
          projectId,
          indexId: index.id,
          type: body.type,
          trigger: body.trigger,
          priority: body.priority,
        },
      });

      // Enqueue to BullMQ
      await enqueueIndexJob(job);

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: request.userId,
        action: 'index:triggered',
        entityType: 'index',
        entityId: index.id,
        details: { type: body.type, trigger: body.trigger, jobId: job.id },
        ipAddress: (request as any).ip,
      });

      return reply.code(202).send({
        data: {
          indexId: index.id,
          jobId: job.id,
          status: 'QUEUED',
        },
      });
    },
  );

  // ─── POST /api/projects/:projectId/indexes/sync — Quick incremental sync ───
  app.post(
    '/api/projects/:projectId/indexes/sync',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      const project = await prisma.project.findFirst({
        where: { id: projectId },
        include: { team: true },
      });
      if (!project) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      // Check concurrency lock — prevent duplicate running jobs for same project
      const locked = await acquireProjectLock(projectId);
      if (!locked) {
        // Already have a running job; still enqueue but mark as pending
        return reply.code(409).send({
          code: 'CONFLICT',
          message: 'Index job already running for this project. Queued for next run.',
        });
      }

      const index = await prisma.index.create({
        data: {
          projectId,
          type: 'INCREMENTAL',
          status: 'QUEUED',
          triggerSource: 'MANUAL',
        },
      });

      const job = await prisma.indexJob.create({
        data: {
          projectId,
          indexId: index.id,
          type: 'INCREMENTAL',
          trigger: 'MANUAL',
          priority: 5, // higher priority for sync
        },
      });

      await enqueueIndexJob(job);

      return reply.code(202).send({
        data: { indexId: index.id, jobId: job.id, status: 'QUEUED' },
      });
    },
  );

  // ─── DELETE /api/indexes/:indexId/cancel — Cancel a queued index job ───
  app.delete(
    '/api/indexes/:indexId/cancel',
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
      if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
      }

      // Only cancel QUEUED jobs
      if (index.status !== 'QUEUED') {
        return reply.code(400).send({
          code: 'BAD_REQUEST',
          message: `Cannot cancel index with status: ${index.status}`,
        });
      }

      const job = await prisma.indexJob.findFirst({
        where: { indexId, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (job) {
        await cancelJob(job.id);
        await prisma.indexJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
      }

      await prisma.index.update({
        where: { id: indexId },
        data: { status: 'FAILED', error: 'Cancelled by user' },
      });

      await createAuditLog({
        organizationId: index.project.team.organizationId,
        userId: request.userId,
        action: 'index:cancelled',
        entityType: 'index',
        entityId: indexId,
        ipAddress: (request as any).ip,
      });

      return reply.send({ data: { indexId, status: 'CANCELLED' } });
    },
  );

  // ─── GET /api/indexes/:indexId — Get index details ───
  app.get(
    '/api/indexes/:indexId',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findFirst({
        where: { id: indexId },
        include: {
          project: { include: { team: { include: { organization: true } } } },
          stats: true,
          _count: { select: { snapshots: true, syncLogs: true } },
        },
      });

      if (!index) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
      }

      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, team: { organizationId: index.project.team.organizationId } },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
      }

      return reply.send({ data: index });
    },
  );

  // ─── GET /api/admin/indexes/queue-stats — Queue statistics (admin/monitoring) ───
  app.get(
    '/api/admin/indexes/queue-stats',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const stats = await getQueueStats();
      return reply.send({ data: stats });
    },
  );
}
