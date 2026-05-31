// Auth plugin for Fastify - JWT verification and API key auth
import fp from 'fastify-plugin';
import jwt, { SignOptions } from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@codegraph/db';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshExpiresIn: string;
  apiPrefix: string;
}

const defaultConfig: AuthConfig = {
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production-min-32-chars',
  jwtExpiresIn: '1h',
  refreshExpiresIn: '7d',
  apiPrefix: '/api',
};

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    userRole: string;
    userEmail: string;
  }
}

/** Generate JWT access token */
export function generateAccessToken(payload: { sub: string; email: string; role: string }, secret: string, expiresIn: string): string {
  return jwt.sign(payload, secret, { expiresIn } as SignOptions);
}

/** Generate refresh token */
export function generateRefreshToken(payload: { sub: string }, secret: string, expiresIn: string): string {
  return jwt.sign(payload, secret, { expiresIn } as SignOptions);
}

/** Decode and verify JWT */
export function verifyToken(token: string, secret: string): jwt.JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
    return decoded;
  } catch {
    return null;
  }
}

/** Generate a new API key (returns raw key + hash + prefix) */
export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `cg_${nanoid(32)}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 8);
  return { raw, hash, prefix };
}

/** Hash API key for storage */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Generate random CSRF/state token */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

export default fp(async function authPlugin(fastify, options) {
  const config = { ...defaultConfig, ...options };

  fastify.decorate('jwtSecret', config.jwtSecret);
  fastify.decorate('generateAccessToken', (payload: { sub: string; email: string; role: string }) =>
    generateAccessToken(payload, config.jwtSecret, config.jwtExpiresIn)
  );
  fastify.decorate('generateRefreshToken', (payload: { sub: string }) =>
    generateRefreshToken(payload, config.jwtSecret, config.refreshExpiresIn)
  );
  fastify.decorate('generateApiKey', generateApiKey);

  // Verify authentication from Authorization header or cookie
  fastify.decorate('authenticate', async function authenticate(request, reply) {
    // Check Bearer token
    const authHeader = request.headers.authorization;
    if (authHeader) {
      // API Key: "Bearer cg_xxxx"
      if (authHeader.startsWith('Bearer cg_')) {
        const rawKey = authHeader.slice(7);
        const keyHash = hashApiKey(rawKey);
        const apiKey = await prisma.apiKey.findFirst({
          where: { keyHash, revokedAt: null },
          include: { user: true },
        });
        if (!apiKey) {
          return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or revoked API key' });
        }
        // Update last used
        await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });
        request.userId = apiKey.userId;
        request.userRole = apiKey.role;
        request.userEmail = apiKey.user.email;
        return;
      }

      // JWT: "Bearer eyJ..."
      const token = authHeader.slice(7);
      const decoded = verifyToken(token, config.jwtSecret);
      if (!decoded || !decoded.sub) {
        return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Invalid or expired token' });
      }
      request.userId = decoded.sub;
      request.userRole = decoded.role;
      request.userEmail = decoded.email;
      return;
    }

    // Check cookie
    const cookieToken = request.cookies?.token;
    if (cookieToken) {
      const decoded = verifyToken(cookieToken, config.jwtSecret);
      if (decoded && decoded.sub) {
        request.userId = decoded.sub;
        request.userRole = decoded.role;
        request.userEmail = decoded.email;
        return;
      }
    }

    return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  });
});
