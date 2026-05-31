import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

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
