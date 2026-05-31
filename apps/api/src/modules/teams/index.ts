// Teams module - CRUD + member management
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { createAuditLog } from '../../lib/audit.js';

export default async function teamRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── Create Team ───
  app.post('/api/organizations/:orgId/teams', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;
    const schema = z.object({ name: z.string().min(2).max(100) });
    const body = schema.parse(request.body);

    // Verify membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role to create teams' });
    }

    // Check name uniqueness within org
    const existing = await prisma.team.findFirst({
      where: { organizationId: orgId, name: body.name },
    });
    if (existing) {
      return reply.code(409).send({ code: 'CONFLICT', message: 'Team name already exists in this organization' });
    }

    const team = await prisma.team.create({
      data: {
        name: body.name,
        organizationId: orgId,
      },
    });

    await createAuditLog({
      organizationId: orgId,
      userId: request.userId,
      action: 'team:created',
      entityType: 'team',
      entityId: team.id,
      details: { name: team.name },
      ipAddress: (request as any).ip,
    });

    return reply.code(201).send({ data: team });
  });

  // ─── Get Team ───
  app.get('/api/teams/:teamId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;

    const team = await prisma.team.findFirst({
      where: { id: teamId },
      include: { organization: true },
    });

    if (!team) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    // Verify membership in org
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: team.organizationId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
    }

    return reply.send({ data: team });
  });

  // ─── Delete Team ───
  app.delete('/api/teams/:teamId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
      include: { team: true },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
    }

    await prisma.team.delete({ where: { id: teamId } });

    await createAuditLog({
      organizationId: membership.team.organizationId,
      userId: request.userId,
      action: 'team:deleted',
      entityType: 'team',
      entityId: teamId,
      ipAddress: (request as any).ip,
    });

    return reply.code(204).send();
  });

  // ─── List Team Members ───
  app.get('/api/teams/:teamId/members', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;

    // Verify membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
    });

    if (!membership) {
      // Also check org membership
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

    const members = await prisma.member.findMany({
      where: { teamId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
    });

    return reply.send({ data: members });
  });

  // ─── Add Team Member ───
  app.post('/api/teams/:teamId/members', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId } = request.params;
    const schema = z.object({
      userId: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER']),
    });
    const body = schema.parse(request.body);

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role to add members' });
    }

    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Team not found' });
    }

    // Check user exists
    const targetUser = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!targetUser) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const member = await prisma.member.create({
      data: {
        teamId,
        userId: body.userId,
        role: body.role,
      },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    await createAuditLog({
      organizationId: team.organizationId,
      userId: request.userId,
      action: 'member:added',
      entityType: 'member',
      entityId: member.id,
      details: { userId: body.userId, role: body.role },
      ipAddress: (request as any).ip,
    });

    return reply.code(201).send({ data: member });
  });

  // ─── Remove Team Member ───
  app.delete('/api/teams/:teamId/members/:memberId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { teamId, memberId } = request.params;

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, teamId },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role to remove members' });
    }

    const team = await prisma.team.findUnique({ where: { id: teamId } });

    // Prevent self-removal if last owner
    if (memberId === membership.id && membership.role === 'OWNER') {
      const ownerCount = await prisma.member.count({
        where: { teamId, role: 'OWNER' },
      });
      if (ownerCount <= 1) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Cannot remove the last owner' });
      }
    }

    await prisma.member.delete({ where: { id: memberId } });

    await createAuditLog({
      organizationId: team?.organizationId ?? '',
      userId: request.userId,
      action: 'member:removed',
      entityType: 'member',
      entityId: memberId,
      ipAddress: (request as any).ip,
    });

    return reply.code(204).send();
  });
}
