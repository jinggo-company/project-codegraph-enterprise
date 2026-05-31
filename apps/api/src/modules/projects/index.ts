// Projects module - CRUD + index listing
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { createAuditLog } from '../../lib/audit.js';

export default async function projectRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── Create Project ───
  app.post('/api/teams/:teamId/projects', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;
    const schema = z.object({
      name: z.string().min(2).max(100),
      gitUrl: z.string().url(),
      branch: z.string().default('main'),
    });
    const body = schema.parse(request.body);

    // Verify membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
      include: { team: { include: { organization: true } } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied: not a team member' });
    }

    // Check role (owner, admin, developer can create projects)
    const roleLevel = { OWNER: 4, ADMIN: 3, DEVELOPER: 2, VIEWER: 1 };
    if (roleLevel[membership.role as keyof typeof roleLevel] < 2) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires developer, admin, or owner role' });
    }

    // Check name uniqueness
    const existing = await prisma.project.findFirst({
      where: { teamId, name: body.name },
    });
    if (existing) {
      return reply.code(409).send({ code: 'CONFLICT', message: 'Project name already exists in this team' });
    }

    // Check subscription limits (free tier: max 3 projects)
    const orgId = membership.team.organizationId;
    const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
    if (sub?.plan === 'FREE') {
      const projectCount = await prisma.project.count({
        where: { team: { organizationId: orgId } },
      });
      if (projectCount >= 3) {
        return reply.code(402).send({
          code: 'PAYMENT_REQUIRED',
          message: 'Free plan limited to 3 projects. Upgrade to Pro for unlimited projects.',
        });
      }
    }

    const project = await prisma.project.create({
      data: {
        teamId,
        name: body.name,
        gitUrl: body.gitUrl,
        branch: body.branch,
        status: 'PENDING_INDEX',
      },
    });

    await createAuditLog({
      organizationId: orgId,
      userId: request.userId,
      action: 'project:created',
      entityType: 'project',
      entityId: project.id,
      details: { name: project.name, gitUrl: project.gitUrl },
      ipAddress: (request as any).ip,
    });

    return reply.code(201).send({ data: project });
  });

  // ─── List Team Projects ───
  app.get('/api/teams/:teamId/projects', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
    });

    if (!membership) {
      // Check org membership for cross-org protection
      const team = await prisma.team.findUnique({ where: { id: teamId } });
      if (!team) {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Team not found' });
      }
      const orgMembership = await prisma.member.findFirst({
        where: { userId: request.userId, team: { organizationId: team.organizationId } },
      });
      if (!orgMembership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
      }
    }

    const projects = await prisma.project.findMany({
      where: { teamId },
      include: {
        _count: { select: { indexes: true } },
        indexes: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, createdAt: true, type: true },
        },
      },
    });

    return reply.send({ data: projects });
  });

  // ─── Get Project ───
  app.get('/api/projects/:projectId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { projectId } = request.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId },
      include: { team: { include: { organization: true } } },
    });

    if (!project) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    // Verify org membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: project.team.organizationId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
    }

    return reply.send({ data: project });
  });

  // ─── Update Project ───
  app.patch('/api/projects/:projectId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { projectId } = request.params;
    const schema = z.object({
      name: z.string().min(2).max(100).optional(),
      gitUrl: z.string().url().optional(),
      branch: z.string().optional(),
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

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN' && membership.role !== 'DEVELOPER')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires developer, admin, or owner role' });
    }

    const updated = await prisma.project.update({
      where: { id: projectId },
      data: body,
    });

    await createAuditLog({
      organizationId: project.team.organizationId,
      userId: request.userId,
      action: 'project:updated',
      entityType: 'project',
      entityId: projectId,
      details: body,
      ipAddress: (request as any).ip,
    });

    return reply.send({ data: updated });
  });

  // ─── Delete Project ───
  app.delete('/api/projects/:projectId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { projectId } = request.params;

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

    // Soft delete - mark as DELETED
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'DELETED' },
    });

    await createAuditLog({
      organizationId: project.team.organizationId,
      userId: request.userId,
      action: 'project:deleted',
      entityType: 'project',
      entityId: projectId,
      ipAddress: (request as any).ip,
    });

    return reply.code(204).send();
  });

  // ─── List Project Indexes ───
  app.get('/api/projects/:projectId/indexes', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { projectId } = request.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId },
      include: { team: { include: { organization: true } } },
    });

    if (!project) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    // Verify org membership (any role can view indexes)
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: project.team.organizationId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
    }

    const indexes = await prisma.index.findMany({
      where: { projectId },
      include: { stats: true, _count: { select: { snapshots: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: indexes });
  });

  // ─── Get Index Status ───
  app.get('/api/indexes/:indexId/status', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { indexId } = request.params;

    const index = await prisma.index.findFirst({
      where: { id: indexId },
      include: {
        project: { include: { team: { include: { organization: true } } } },
        stats: true,
      },
    });

    if (!index) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Index not found' });
    }

    // Verify org membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: index.project.team.organizationId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
    }

    return reply.send({
      data: {
        id: index.id,
        status: index.status,
        type: index.type,
        triggerSource: index.triggerSource,
        createdAt: index.createdAt,
        startedAt: index.startedAt,
        completedAt: index.completedAt,
        error: index.error,
        stats: index.stats,
      },
    });
  });
}
