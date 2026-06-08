// Index Scheduler REST API — T-2026-00133
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { enqueueIndexJob } from '../../lib/scheduler.js';
import { acquireProjectLock, releaseProjectLock, checkRateLimit } from '../../lib/concurrency.js';
import { createAuditLog } from '../../lib/audit.js';

export default async function indexRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── List Project Indexes ───
  // AC-3: GET /api/projects/:id/indexes returns index list
  app.get(
    '/api/projects/:projectId/indexes',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      // Verify project access
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

      const indexes = await prisma.index.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        include: { stats: true, snapshots: { orderBy: { createdAt: 'desc' } } },
      });

      return reply.send({ data: indexes });
    }
  );

  // ─── Trigger Full Index Build ───
  // AC-1: POST /api/projects/:id/indexes/build creates IndexJob + enqueues BullMQ
  app.post(
    '/api/projects/:projectId/indexes/build',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      // Verify access
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

      // RBAC role check: viewer cannot trigger builds
      const role = membership.role.toLowerCase();
      if (role === 'viewer') {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Viewer role cannot trigger index builds' });
      }

      // Rate limit check
      const withinRate = await checkRateLimit(projectId);
      if (!withinRate) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded for project',
        });
      }

      // Concurrency lock check
      const locked = await acquireProjectLock(projectId);
      if (!locked) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: 'Project currently indexing',
        });
      }

      // Create Index record (IndexJob model via Index)
      const index = await prisma.index.create({
        data: {
          projectId,
          type: 'FULL',
          status: 'QUEUED',
          triggerSource: 'MANUAL',
        },
      });

      // Update project status
      await prisma.project.update({
        where: { id: projectId },
        data: { status: 'INDEXING' },
      });

      // Enqueue to BullMQ
      await enqueueIndexJob({
        id: index.id,
        projectId,
        indexId: index.id,
        type: 'FULL',
        trigger: 'MANUAL',
        priority: 0,
      });

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: request.userId,
        action: 'index:build_triggered',
        entityType: 'index',
        entityId: index.id,
        details: { type: 'full' },
        ipAddress: (request as any).ip,
      });

      return reply.code(202).send({
        data: index,
        message: 'Index build queued',
      });
    }
  );

  // ─── Trigger Incremental Sync ───
  // AC-2: POST /api/projects/:id/indexes/sync creates incremental sync task
  app.post(
    '/api/projects/:projectId/indexes/sync',
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

      // Find latest completed index for incremental merge
      const latestIndex = await prisma.index.findFirst({
        where: {
          projectId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!latestIndex) {
        return reply.code(400).send({
          code: 'BAD_REQUEST',
          message: 'No completed index found. Run a full build first.',
        });
      }

      // Rate limit check
      const withinRate = await checkRateLimit(projectId);
      if (!withinRate) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded for project',
        });
      }

      // Concurrency lock check
      const locked = await acquireProjectLock(projectId);
      if (!locked) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: 'Project currently indexing',
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

      // Enqueue to BullMQ
      await enqueueIndexJob({
        id: index.id,
        projectId,
        indexId: index.id,
        type: 'INCREMENTAL',
        trigger: 'MANUAL',
        priority: 5,
      });

      await createAuditLog({
        organizationId: project.team.organizationId,
        userId: request.userId,
        action: 'index:sync_triggered',
        entityType: 'index',
        entityId: index.id,
        details: { type: 'incremental', baseIndexId: latestIndex.id },
        ipAddress: (request as any).ip,
      });

      return reply.code(202).send({
        data: index,
        message: 'Incremental sync queued',
      });
    }
  );

  // ─── Get Index Status ───
  // AC-4: GET /api/indexes/:indexId/status returns status
  app.get(
    '/api/indexes/:indexId/status',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findFirst({
        where: { id: indexId },
        include: {
          stats: true,
          snapshots: { orderBy: { createdAt: 'desc' } },
          project: true,
        },
      });
      if (!index) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
      }

      return reply.send({ data: index });
    }
  );

  // ─── Get Index Stats ───
  // AC-5: GET /api/indexes/:indexId/stats returns statistics
  app.get(
    '/api/indexes/:indexId/stats',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const stats = await prisma.indexStats.findFirst({
        where: { indexId },
        include: { index: true },
      });
      if (!stats) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Stats not available' });
      }

      return reply.send({ data: stats });
    }
  );

  // ─── List All Indexes for Organization (F2: Console Overview) ───
  // GET /api/organizations/:orgId/indexes — lists all indexes across all projects in org
  app.get(
    '/api/organizations/:orgId/indexes',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const { status, type, triggerSource, page = '1', limit = '20' } = request.query as Record<string, string>;

      // Verify org membership
      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, team: { organizationId: orgId } },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const where: Record<string, unknown> = {
        project: { team: { organizationId: orgId } },
      };
      if (status) where.status = status.toUpperCase();
      if (type) where.type = type.toUpperCase();
      if (triggerSource) where.triggerSource = triggerSource.toUpperCase();

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      const [indexes, total] = await Promise.all([
        prisma.index.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            project: { select: { id: true, name: true, gitUrl: true, team: { select: { name: true } } } },
            stats: true,
            snapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
          skip,
          take: limitNum,
        }),
        prisma.index.count({ where }),
      ]);

      return reply.send({ data: indexes, total, page: pageNum, limit: limitNum });
    }
  );

  // ─── Cancel Index Build (F2: Manual Control) ───
  // POST /api/indexes/:indexId/cancel — cancels a queued/running index build
  app.post(
    '/api/indexes/:indexId/cancel',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findFirst({
        where: { id: indexId },
        include: { project: { include: { team: { include: { organization: true } } } } },
      });
      if (!index) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
      }

      // Verify access
      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: index.project.teamId },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      // Can only cancel QUEUED or RUNNING
      if (index.status !== 'QUEUED' && index.status !== 'RUNNING') {
        return reply.code(400).send({
          code: 'BAD_REQUEST',
          message: `Cannot cancel index with status ${index.status}`,
        });
      }

      const updated = await prisma.index.update({
        where: { id: indexId },
        data: { status: 'FAILED', error: 'Cancelled by user' },
      });

      // Release project lock
      const { releaseProjectLock } = await import('../../lib/concurrency.js');
      await releaseProjectLock(index.projectId);

      // Revert project status if no other running indexes
      const runningCount = await prisma.index.count({
        where: { projectId: index.projectId, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (runningCount === 0) {
        await prisma.project.update({
          where: { id: index.projectId },
          data: { status: 'PENDING_INDEX' },
        });
      }

      await createAuditLog({
        organizationId: index.project.team.organizationId,
        userId: request.userId,
        action: 'index:cancelled',
        entityType: 'index',
        entityId: indexId,
        ipAddress: (request as any).ip,
      });

      return reply.send({ data: updated, message: 'Index build cancelled' });
    }
  );

  // ─── Trigger Rebuild (F2: Manual Re-trigger on any index) ───
  // POST /api/indexes/:indexId/rebuild — rebuilds from the same project
  app.post(
    '/api/indexes/:indexId/rebuild',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const existingIndex = await prisma.index.findFirst({
        where: { id: indexId },
        include: { project: { include: { team: { include: { organization: true } } } } },
      });
      if (!existingIndex) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
      }

      // Verify access
      const membership = await prisma.member.findFirst({
        where: { userId: request.userId, teamId: existingIndex.project.teamId },
      });
      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      if (membership.role === 'VIEWER') {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Viewer role cannot trigger rebuilds' });
      }

      const { acquireProjectLock, checkRateLimit } = await import('../../lib/concurrency.js');

      const withinRate = await checkRateLimit(existingIndex.projectId);
      if (!withinRate) {
        return reply.code(429).send({ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' });
      }

      const locked = await acquireProjectLock(existingIndex.projectId);
      if (!locked) {
        return reply.code(429).send({ code: 'TOO_MANY_REQUESTS', message: 'Project currently indexing' });
      }

      const index = await prisma.index.create({
        data: {
          projectId: existingIndex.projectId,
          type: 'FULL',
          status: 'QUEUED',
          triggerSource: 'MANUAL',
        },
      });

      await prisma.project.update({
        where: { id: existingIndex.projectId },
        data: { status: 'INDEXING' },
      });

      const { enqueueIndexJob } = await import('../../lib/scheduler.js');
      await enqueueIndexJob({
        id: index.id,
        projectId: existingIndex.projectId,
        indexId: index.id,
        type: 'FULL',
        trigger: 'MANUAL',
        priority: 0,
      });

      await createAuditLog({
        organizationId: existingIndex.project.team.organizationId,
        userId: request.userId,
        action: 'index:rebuild_triggered',
        entityType: 'index',
        entityId: index.id,
        details: { sourceIndexId: indexId },
        ipAddress: (request as any).ip,
      });

      return reply.code(202).send({ data: index, message: 'Rebuild queued' });
    }
  );
}
