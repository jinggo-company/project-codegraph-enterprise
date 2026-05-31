import { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    jwtSecret: string;
    generateAccessToken: (payload: { sub: string; email: string; role: string }) => string;
    generateRefreshToken: (payload: { sub: string }) => string;
    generateApiKey: () => { raw: string; hash: string; prefix: string };
    authenticate: (request: FastifyRequest, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    userId: string;
    userRole: string;
    userEmail: string;
  }
}

export {};
