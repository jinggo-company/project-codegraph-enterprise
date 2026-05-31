// Organizations module - CRUD with multi-tenant isolation
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { createAuditLog } from '../../lib/audit.js';

export default async function orgRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── Create Organization ───
  app.post('/api/organizations', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const schema = z.object({
      name: z.string().min(2).max(100),
      slug: z.string().min(2).max(50).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    });
    const body = schema.parse(request.body);

    // Check slug uniqueness
    const existing = await prisma.organization.findUnique({ where: { slug: body.slug } });
    if (existing) {
      return reply.code(409).send({ code: 'CONFLICT', message: 'Organization slug already taken' });
    }

    const org = await prisma.organization.create({
      data: {
        name: body.name,
        slug: body.slug,
        subscription: { create: { plan: 'FREE', status: 'ACTIVE' } },
      },
    });

    // Auto-create a default team and add user as owner
    const defaultTeam = await prisma.team.create({
      data: {
        name: 'default',
        organizationId: org.id,
        members: {
          create: {
            userId: request.userId,
            role: 'OWNER',
          },
        },
      },
    });

    await createAuditLog({
      organizationId: org.id,
      userId: request.userId,
      action: 'organization:created',
      entityType: 'organization',
      entityId: org.id,
      details: { name: org.name, slug: org.slug },
      ipAddress: (request as any).ip,
    });

    return reply.code(201).send({ data: { ...org, defaultTeamId: defaultTeam.id } });
  });

  // ─── List Organizations ───
  app.get('/api/organizations', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    // Find all orgs where user is a member
    const memberships = await prisma.member.findMany({
      where: { userId: request.userId },
      include: { team: { include: { organization: true } } },
    });

    const orgs = memberships
      .map((m: any) => m.team.organization)
      .filter((v: any, i: number, a: any) => a.findIndex((t: any) => t.id === v.id) === i); // deduplicate

    return reply.send({ data: orgs });
  });

  // ─── Get Organization ───
  app.get('/api/organizations/:orgId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;

    // Verify membership
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
      include: { team: { include: { organization: true } } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied: not a member' });
    }

    return reply.send({ data: membership.team.organization });
  });

  // ─── Update Organization ───
  app.patch('/api/organizations/:orgId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;
    const schema = z.object({ name: z.string().min(2).max(100).optional() });
    const body = schema.parse(request.body);

    // Check membership + role
    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
    });

    if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ADMIN')) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner or admin role' });
    }

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: body,
    });

    await createAuditLog({
      organizationId: orgId,
      userId: request.userId,
      action: 'organization:updated',
      entityType: 'organization',
      entityId: orgId,
      details: body,
      ipAddress: (request as any).ip,
    });

    return reply.send({ data: org });
  });

  // ─── Delete Organization ───
  app.delete('/api/organizations/:orgId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
    });

    if (!membership || membership.role !== 'OWNER') {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Requires owner role' });
    }

    await prisma.organization.delete({ where: { id: orgId } });

    await createAuditLog({
      organizationId: orgId,
      userId: request.userId,
      action: 'organization:deleted',
      entityType: 'organization',
      entityId: orgId,
      ipAddress: (request as any).ip,
    });

    return reply.code(204).send();
  });

  // ─── Get Organization Teams ───
  app.get('/api/organizations/:orgId/teams', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { orgId } = request.params;

    const membership = await prisma.member.findFirst({
      where: { userId: request.userId, team: { organizationId: orgId } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    const teams = await prisma.team.findMany({
      where: { organizationId: orgId },
      include: { _count: { select: { members: true, projects: true } } },
    });

    return reply.send({ data: teams });
  });
}
