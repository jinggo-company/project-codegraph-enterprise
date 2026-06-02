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
}
