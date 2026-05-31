// Auth module - OAuth, JWT, API Keys
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '@codegraph/db';
import { generateApiKey, generateState, verifyToken } from '../../plugins/auth.js';
import { createAuditLog } from '../../lib/audit.js';

interface GitHubUserInfo {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  login: string;
}

interface GitLabUserInfo {
  id: number;
  email: string;
  name: string;
  avatar_url: string;
  username: string;
}

// In-memory OAuth state store (use Redis in production)
const oauthStates = new Map<string, { provider: string; redirectUri?: string }>();

// GitHub OAuth endpoints
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

// GitLab OAuth endpoints
const GITLAB_AUTH_URL = 'https://gitlab.com/oauth/authorize';
const GITLAB_TOKEN_URL = 'https://gitlab.com/oauth/token';
const GITLAB_USER_URL = 'https://gitlab.com/api/v4/user';

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'dev-github-client-id';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'dev-github-secret';
const GITLAB_CLIENT_ID = process.env.GITLAB_CLIENT_ID || 'dev-gitlab-client-id';
const GITLAB_CLIENT_SECRET = process.env.GITLAB_CLIENT_SECRET || 'dev-gitlab-secret';
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:4000';

async function fetchGitHubUser(accessToken: string): Promise<GitHubUserInfo & { email?: string }> {
  const [userRes, emailsRes] = await Promise.all([
    fetch(GITHUB_USER_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }),
    fetch(GITHUB_EMAILS_URL, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }),
  ]);
  const user = await userRes.json() as GitHubUserInfo;
  const emails = await emailsRes.json() as { email: string; primary: boolean; verified: boolean }[];
  const primaryEmail = emails.find(e => e.primary && e.verified);
  return { ...user, email: primaryEmail?.email || user.login + '@github.com' };
}

async function fetchGitLabUser(accessToken: string): Promise<GitLabUserInfo> {
  const res = await fetch(GITLAB_USER_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  return res.json() as Promise<GitLabUserInfo>;
}

async function findOrCreateUser(email: string, provider: string, providerId: string, accessToken: string, name?: string, avatarUrl?: string) {
  // Check existing OAuth account
  let oauthAccount = await prisma.oAuthAccount.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  });

  if (oauthAccount) {
    return { user: oauthAccount.user, account: oauthAccount, isNew: false };
  }

  // Check existing user by email
  let user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    oauthAccount = await prisma.oAuthAccount.create({
      data: {
        userId: user.id,
        provider,
        providerId,
        accessToken,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      },
      include: { user: true },
    });
    return { user: (oauthAccount as any).user, account: oauthAccount, isNew: false };
  }

  // Create new user
  const newUser = await prisma.user.create({
    data: {
      email,
      name: name || email.split('@')[0],
      avatarUrl: avatarUrl || null,
      emailVerified: new Date(),
      oauthAccounts: {
        create: {
          provider,
          providerId,
          accessToken,
          expiresAt: new Date(Date.now() + 3600 * 1000),
        },
      },
    },
    include: { oauthAccounts: true },
  });

  return { user: newUser, account: (newUser as any).oauthAccounts[0], isNew: true };
}

export default async function authRoutes(fastify: FastifyInstance) {
  const app = fastify;

  // ─── Register ───
  app.post('/api/auth/register', async (request, reply) => {
    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(1).optional(),
    });
    const body = schema.parse(request.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.code(409).send({ code: 'CONFLICT', message: 'Email already registered' });
    }

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name || body.email.split('@')[0],
      },
    });

    return reply.code(201).send({ data: user });
  });

  // ─── OAuth Init (GitHub) ───
  app.get('/api/auth/oauth/github', async (request, reply) => {
    const state = generateState();
    const redirectUri = `${APP_BASE_URL}/api/auth/oauth/github/callback`;
    oauthStates.set(state, { provider: 'github' });

    const authUrl = new URL(GITHUB_AUTH_URL);
    authUrl.searchParams.set('client_id', GITHUB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', 'read:user user:email');

    return reply.redirect(authUrl.toString());
  });

  // ─── OAuth Callback (GitHub) ───
  app.get('/api/auth/oauth/github/callback', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { code, state } = query;

    if (!code || !state || !oauthStates.has(state)) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Invalid OAuth callback' });
    }
    oauthStates.delete(state);

    // Exchange code for token
    const tokenRes = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${APP_BASE_URL}/api/auth/oauth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token: string; token_type: string };

    if (!tokenData.access_token) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Failed to get access token', details: tokenData });
    }

    // Fetch user info
    const userInfo = await fetchGitHubUser(tokenData.access_token);

    const { user, isNew } = await findOrCreateUser(
      userInfo.email, 'github', String(userInfo.id), tokenData.access_token,
      userInfo.name, userInfo.avatar_url
    );

    // Generate tokens
    const accessToken = app.generateAccessToken({ sub: user.id, email: user.email, role: 'developer' });
    const refreshToken = app.generateRefreshToken({ sub: user.id });

    if (isNew) {
      await createAuditLog({
        organizationId: 'system',
        userId: user.id,
        action: 'user:registered',
        entityType: 'user',
        entityId: user.id,
        details: { provider: 'github' },
        ipAddress: (request as any).ip,
      });
    }

    return reply.send({
      data: {
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
        accessToken,
        refreshToken,
        expiresIn: 3600,
      },
    });
  });

  // ─── OAuth Init (GitLab) ───
  app.get('/api/auth/oauth/gitlab', async (request, reply) => {
    const state = generateState();
    const redirectUri = `${APP_BASE_URL}/api/auth/oauth/gitlab/callback`;
    oauthStates.set(state, { provider: 'gitlab' });

    const authUrl = new URL(GITLAB_AUTH_URL);
    authUrl.searchParams.set('client_id', GITLAB_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'read_user');

    return reply.redirect(authUrl.toString());
  });

  // ─── OAuth Callback (GitLab) ───
  app.get('/api/auth/oauth/gitlab/callback', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const { code, state } = query;

    if (!code || !state || !oauthStates.has(state)) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Invalid OAuth callback' });
    }
    oauthStates.delete(state);

    const tokenRes = await fetch(GITLAB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: GITLAB_CLIENT_ID,
        client_secret: GITLAB_CLIENT_SECRET,
        code,
        redirect_uri: `${APP_BASE_URL}/api/auth/oauth/gitlab/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };

    if (!tokenData.access_token) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Failed to get access token' });
    }

    const userInfo = await fetchGitLabUser(tokenData.access_token);

    const { user, isNew } = await findOrCreateUser(
      userInfo.email, 'gitlab', String(userInfo.id), tokenData.access_token,
      userInfo.name, userInfo.avatar_url
    );

    const accessToken = app.generateAccessToken({ sub: user.id, email: user.email, role: 'developer' });
    const refreshToken = app.generateRefreshToken({ sub: user.id });

    if (isNew) {
      await createAuditLog({
        organizationId: 'system',
        userId: user.id,
        action: 'user:registered',
        entityType: 'user',
        entityId: user.id,
        details: { provider: 'gitlab' },
        ipAddress: (request as any).ip,
      });
    }

    return reply.send({
      data: {
        user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
        accessToken,
        refreshToken,
        expiresIn: 3600,
      },
    });
  });

  // ─── Token Refresh ───
  app.post('/api/auth/token/refresh', async (request, reply) => {
    const schema = z.object({ refreshToken: z.string() });
    const body = schema.parse(request.body);

    const decoded = verifyToken(body.refreshToken, app.jwtSecret) as { sub: string } | null;
    if (!decoded?.sub) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'User not found' });
    }

    const accessToken = app.generateAccessToken({ sub: user.id, email: user.email, role: 'developer' });
    const newRefreshToken = app.generateRefreshToken({ sub: user.id });

    return reply.send({ data: { accessToken, refreshToken: newRefreshToken, expiresIn: 3600 } });
  });

  // ─── API Key Management (authenticated) ───
  app.post('/api/auth/apikey', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const schema = z.object({ name: z.string().min(1).max(64), role: z.enum(['owner', 'admin', 'developer', 'viewer']).default('developer') });
    const body = schema.parse(request.body);

    const { raw, hash, prefix } = app.generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: request.userId,
        name: body.name,
        keyHash: hash,
        prefix,
        role: body.role.toUpperCase() as any,
      },
    });

    await createAuditLog({
      organizationId: 'system',
      userId: request.userId,
      action: 'apikey:created',
      entityType: 'apikey',
      entityId: apiKey.id,
      details: { name: body.name, prefix },
      ipAddress: (request as any).ip,
    });

    return reply.code(201).send({
      data: {
        id: apiKey.id,
        name: apiKey.name,
        key: raw, // Return raw key only once
        prefix: apiKey.prefix,
        role: apiKey.role,
        createdAt: apiKey.createdAt,
      },
    });
  });

  app.get('/api/auth/apikey', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: request.userId },
      select: { id: true, name: true, prefix: true, role: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ data: keys });
  });

  // ─── API Key Rotation ───
  app.post('/api/auth/apikey/:keyId/rotate', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { keyId } = request.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, userId: request.userId },
    });
    if (!existing) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'API key not found' });
    }

    // Revoke old key
    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    // Create new key
    const { raw, hash, prefix } = app.generateApiKey();
    const newKey = await prisma.apiKey.create({
      data: {
        userId: request.userId,
        name: existing.name,
        keyHash: hash,
        prefix,
        role: existing.role,
      },
    });

    await createAuditLog({
      organizationId: 'system',
      userId: request.userId,
      action: 'apikey:rotated',
      entityType: 'apikey',
      entityId: keyId,
      details: { oldKey: existing.prefix, newPrefix: prefix },
      ipAddress: (request as any).ip,
    });

    return reply.send({
      data: {
        id: newKey.id,
        name: newKey.name,
        key: raw,
        prefix: newKey.prefix,
        role: newKey.role,
        createdAt: newKey.createdAt,
      },
    });
  });

  // ─── API Key Revoke ───
  app.delete('/api/auth/apikey/:keyId', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const { keyId } = request.params;

    const existing = await prisma.apiKey.findFirst({
      where: { id: keyId, userId: request.userId, revokedAt: null },
    });
    if (!existing) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'API key not found or already revoked' });
    }

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    await createAuditLog({
      organizationId: 'system',
      userId: request.userId,
      action: 'apikey:revoked',
      entityType: 'apikey',
      entityId: keyId,
      ipAddress: (request as any).ip,
    });

    return reply.code(204).send();
  });

  // ─── Current User Info ───
  app.get('/api/auth/me', { preHandler: [app.authenticate as any] }, async (request: any, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { id: true, email: true, name: true, avatarUrl: true, createdAt: true },
    });

    if (!user) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return reply.send({ data: user });
  });
}
