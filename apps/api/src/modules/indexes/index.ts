// Index module — full/incremental/cleanup + status + stats
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { enqueueIndexJob, buildQueue, syncQueue, cleanupQueue } from '../../lib/scheduler.js';
import { tryAcquireForIndex, releaseProjectLock } from '../../lib/concurrency.js';
import { createAuditLog } from '../../lib/audit.js';

export default async function indexRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── List Project Indexes ───
  app.get(
    '/api/projects/:projectId/indexes',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      // Verify project access
      const project = await prisma.project.findUnique({
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
  app.post(
    '/api/projects/:projectId/indexes/build',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      // Verify access
      const project = await prisma.project.findUnique({
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

      // Concurrency control
      const lockResult = await tryAcquireForIndex(projectId);
      if (!lockResult.allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: lockResult.reason,
        });
      }

      // Create Index record
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

      // Enqueue job
      await enqueueIndexJob({
        projectId,
        type: 'full',
        triggerSource: 'manual',
        gitUrl: project.gitUrl,
        branch: project.branch,
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
  app.post(
    '/api/projects/:projectId/indexes/sync',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { projectId } = request.params;

      const project = await prisma.project.findUnique({
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

      // Concurrency control
      const lockResult = await tryAcquireForIndex(projectId);
      if (!lockResult.allowed) {
        return reply.code(429).send({
          code: 'TOO_MANY_REQUESTS',
          message: lockResult.reason,
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

      await enqueueIndexJob({
        projectId,
        type: 'incremental',
        triggerSource: 'manual',
        gitUrl: project.gitUrl,
        branch: project.branch,
        previousIndexId: latestIndex.id,
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

  // ─── Trigger Index Cleanup ───
  app.post(
    '/api/indexes/:indexId/cleanup',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findUnique({
        where: { id: indexId },
        include: { project: { include: { team: { include: { organization: true } } } } },
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

      // Cleanup old snapshots
      const snapshots = await prisma.snapshot.findMany({
        where: { indexId },
      });

      await enqueueIndexJob({
        projectId: index.projectId,
        type: 'cleanup',
        triggerSource: 'manual',
        gitUrl: index.project.gitUrl,
        branch: index.project.branch,
        previousIndexId: indexId,
      });

      await createAuditLog({
        organizationId: index.project.team.organizationId,
        userId: request.userId,
        action: 'index:cleanup_triggered',
        entityType: 'index',
        entityId: indexId,
        details: { snapshotCount: snapshots.length },
        ipAddress: (request as any).ip,
      });

      return reply.code(202).send({
        message: 'Cleanup queued',
      });
    }
  );

  // ─── Get Index Status ───
  app.get(
    '/api/indexes/:indexId/status',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const index = await prisma.index.findUnique({
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
  app.get(
    '/api/indexes/:indexId/stats',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { indexId } = request.params;

      const stats = await prisma.indexStats.findUnique({
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
