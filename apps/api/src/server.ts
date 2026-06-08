import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import authPlugin from './plugins/auth.js';
import rbacPlugin from './plugins/rbac.js';
import authRoutes from './modules/auth/index.js';
import orgRoutes from './modules/organizations/index.js';
import teamRoutes from './modules/teams/index.js';
import projectRoutes from './modules/projects/index.js';
import indexRoutes from './modules/indexes/index.js';
import webhookRoutes from './modules/webhooks/index.js';
import { registerAuditModule } from './modules/audit/index.js';
import { registerBillingModule } from './modules/billing/index.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
  },
});

// Register plugins
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(cookie);

await app.register(swagger, {
  openapi: {
    info: {
      title: 'CodeGraph Enterprise API',
      description: 'API for CodeGraph Enterprise - code knowledge graph platform',
      version: '0.1.0',
    },
    servers: [
      { url: 'http://localhost:4000', description: 'Development' },
    ],
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
});

// Auth plugin
await app.register(authPlugin);

// RBAC plugin
await app.register(rbacPlugin);

// Health check
app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  service: 'api',
}));

// API routes placeholder
app.get('/api', async () => ({
  message: 'CodeGraph Enterprise API',
  version: '0.1.0',
}));

// Register modules
await app.register(authRoutes);
await app.register(orgRoutes);
await app.register(teamRoutes);
await app.register(projectRoutes);
await app.register(indexRoutes);
await app.register(webhookRoutes);
await app.register(registerAuditModule);
await app.register(registerBillingModule);

// Start server
const port = parseInt(process.env.PORT ?? '4000', 10);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`API server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
