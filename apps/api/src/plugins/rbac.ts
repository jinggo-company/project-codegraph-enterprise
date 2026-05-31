// RBAC middleware - role-based access control with team context
import fp from 'fastify-plugin';
import { prisma } from '@codegraph/db';
import { PERMISSIONS, type Role } from '@codegraph/types';

type RoleName = 'owner' | 'admin' | 'developer' | 'viewer';

const ROLE_LEVEL: Record<RoleName, number> = {
  owner: 4,
  admin: 3,
  developer: 2,
  viewer: 1,
};

/**
 * requireRole returns a route preHandler that:
 * 1. Confirms the user is authenticated (request.userId set by auth plugin)
 * 2. Looks up the user's role in the target team
 * 3. Checks the role has sufficient level for the requested action
 * 4. Verifies the resource belongs to the user's organization (tenant isolation)
 */
export function requireRole(permission: string) {
  return async function preHandler(request: any, reply: any) {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const requiredRoles = PERMISSIONS[permission];
    if (!requiredRoles) {
      return reply.code(500).send({ code: 'INTERNAL', message: `Unknown permission: ${permission}` });
    }

    // Determine teamId from route params
    const teamId = request.params.teamId || request.params.team_id || request.params.id;
    const projectId = request.params.projectId || request.params.project_id;

    if (teamId) {
      // Look up membership
      const membership = await prisma.member.findFirst({
        where: { teamId, userId },
        include: { team: { include: { organization: true } } },
      });

      if (!membership) {
        return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied: not a team member' });
      }

      const userRole = membership.role.toLowerCase() as RoleName;
      const minLevel = Math.min(...requiredRoles.map((r: string) => ROLE_LEVEL[r as RoleName]));

      if (ROLE_LEVEL[userRole] < minLevel) {
        return reply.code(403).send({
          code: 'FORBIDDEN',
          message: `Access denied: requires ${requiredRoles.join(' or ')} role`,
        });
      }

      // Attach context
      request.organizationId = membership.team.organizationId;
      request.teamId = membership.team.id;
      request.membership = membership;
    }

    // If projectId, verify the project belongs to the user's org
    if (projectId && request.organizationId) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, team: { organizationId: request.organizationId } },
      });
      if (!project && permission !== 'project:create') {
        return reply.code(404).send({ code: 'NOT_FOUND', message: 'Project not found or access denied' });
      }
    }
  };
}

/**
 * requireOrgMembership - checks user belongs to the organization (for org-level operations)
 */
export function requireOrgMembership() {
  return async function preHandler(request: any, reply: any) {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }

    const orgId = request.params.orgId || request.params.organizationId;
    if (!orgId) return;

    // Check if user is a member of any team in this org
    const membership = await prisma.member.findFirst({
      where: { userId, team: { organizationId: orgId } },
      include: { team: { include: { organization: true } } },
    });

    if (!membership) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Access denied: not an org member' });
    }

    request.organizationId = membership.team.organizationId;
    request.membership = membership;
  };
}

/**
 * Cross-org isolation middleware - ensures a resource belongs to the caller's org
 */
export function requireSameOrg(model: string, param: string) {
  return async function preHandler(request: any, reply: any) {
    const userId = request.userId;
    const resourceId = request.params[param];
    if (!userId || !resourceId) return;

    // Get caller's orgs
    const callerOrgs = await prisma.member.findMany({
      where: { userId },
      select: { team: { select: { organizationId: true } } },
    });
    const orgIds = new Set(callerOrgs.map((m: any) => m.team.organizationId));

    // Check resource org
    let resourceOrgId: string | null = null;
    switch (model) {
      case 'project': {
        const proj = await prisma.project.findUnique({ where: { id: resourceId }, include: { team: true } });
        resourceOrgId = proj?.team.organizationId ?? null;
        break;
      }
      case 'team': {
        const team = await prisma.team.findUnique({ where: { id: resourceId } });
        resourceOrgId = team?.organizationId ?? null;
        break;
      }
      case 'organization': {
        resourceOrgId = resourceId;
        break;
      }
    }

    if (resourceOrgId && !orgIds.has(resourceOrgId)) {
      return reply.code(403).send({ code: 'FORBIDDEN', message: 'Cross-organization access denied' });
    }
  };
}

export default fp(async function rbacPlugin(fastify) {
  fastify.decorate('requireRole', requireRole);
  fastify.decorate('requireOrgMembership', requireOrgMembership);
});
