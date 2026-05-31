/**
 * Billing & Subscription Module — CodeGraph Enterprise
 *
 * Manages subscription plans, upgrades/downgrades, payment webhooks
 * (Alipay / Stripe), and invoice queries.
 *
 * Routes:
 *   GET    /api/organizations/:orgId/subscription
 *   POST   /api/billing/subscribe
 *   GET    /api/organizations/:orgId/invoices
 *   POST   /api/billing/webhook/:provider
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@codegraph/db';
import { requireRole } from '../../plugins/rbac';
import { logAudit } from '../audit/index';
import { createHmac } from 'node:crypto';

// ─── Plan definitions ─────────────────────────────────────────────────────

export const PLANS = {
  free: { projectLimit: 3, maxSymbols: 10000, price: 0 },
  pro: { projectLimit: 20, maxSymbols: 500000, price: 9900 }, // in cents (¥99)
  enterprise: { projectLimit: -1, maxSymbols: -1, price: -1 },
} as const;

export type PlanName = keyof typeof PLANS;

// ─── GET /api/organizations/:orgId/subscription ───────────────────────────

async function getSubscription(app: FastifyInstance) {
  app.get(
    '/api/organizations/:orgId/subscription',
    {
      preHandler: [requireRole(['owner', 'admin', 'developer', 'viewer'])],
      schema: {
        tags: ['billing'],
        summary: 'Get current subscription for an organization',
        params: {
          type: 'object',
          properties: { orgId: { type: 'string' } },
          required: ['orgId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              plan: { type: 'string' },
              status: { type: 'string' },
              expiresAt: { type: ['string', 'null'] },
              projectLimit: { type: 'integer' },
              maxSymbols: { type: 'integer' },
              price: { type: 'integer' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
      const plan = PLANS[(sub?.plan ?? 'free') as PlanName];

      return reply.send({
        plan: sub?.plan ?? 'free',
        status: sub?.status ?? 'active',
        expiresAt: sub?.expiresAt?.toISOString() ?? null,
        projectLimit: plan.projectLimit,
        maxSymbols: plan.maxSymbols,
        price: plan.price,
      });
    },
  );
}

// ─── POST /api/billing/subscribe ──────────────────────────────────────────

async function subscribe(app: FastifyInstance) {
  app.post(
    '/api/billing/subscribe',
    {
      preHandler: [requireRole(['owner', 'admin'])],
      schema: {
        tags: ['billing'],
        summary: 'Upgrade or downgrade subscription plan',
        body: {
          type: 'object',
          properties: {
            organizationId: { type: 'string' },
            plan: { type: 'string', enum: ['free', 'pro', 'enterprise'] },
            paymentMethod: { type: 'string', enum: ['alipay', 'stripe'] },
          },
          required: ['organizationId', 'plan'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              plan: { type: 'string' },
              redirectUrl: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        organizationId: string;
        plan: PlanName;
        paymentMethod?: 'alipay' | 'stripe';
      };

      const { organizationId, plan, paymentMethod } = body;

      // Check project limit for downgrade
      if (plan !== 'free') {
        const projectCount = await prisma.project.count({
          where: { team: { organizationId } },
        });
        if (projectCount > PLANS[plan].projectLimit) {
          return reply.code(422).send({
            error: `Cannot downgrade to ${plan}: current project count (${projectCount}) exceeds limit (${PLANS[plan].projectLimit})`,
          });
        }
      }

      // For free plan, just update
      if (plan === 'free') {
        await prisma.subscription.upsert({
          where: { organizationId },
          update: { plan: 'free', status: 'active', expiresAt: null },
          create: {
            organizationId,
            plan: 'free',
            status: 'active',
            expiresAt: null,
          },
        });
        return reply.send({ success: true, plan: 'free', redirectUrl: null });
      }

      // For paid plans: create pending invoice and redirect to payment
      const planDef = PLANS[plan];
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + 1);

      const invoice = await prisma.invoice.create({
        data: {
          organizationId,
          plan,
          amount: planDef.price,
          currency: 'CNY',
          status: 'pending',
          dueAt: expiresAt,
        },
      });

      await prisma.subscription.upsert({
        where: { organizationId },
        update: { plan, status: 'pending', expiresAt },
        create: { organizationId, plan, status: 'pending', expiresAt },
      });

      // Generate mock payment redirect URL
      const redirectUrl = paymentMethod === 'alipay'
        ? `https://openapi.alipay.com/gateway.do?invoice=${invoice.id}`
        : `https://checkout.stripe.com/pay?invoice=${invoice.id}`;

      await logAudit({
        userId: (request as any).user?.id ?? 'unknown',
        userName: (request as any).user?.name ?? 'unknown',
        action: 'UPDATE_SUBSCRIPTION',
        resource: `upgrade to ${plan}`,
        organizationId,
        details: { invoiceId: invoice.id, paymentMethod },
      });

      return reply.send({ success: true, plan, redirectUrl });
    },
  );
}

// ─── GET /api/organizations/:orgId/invoices ───────────────────────────────

async function getInvoices(app: FastifyInstance) {
  app.get(
    '/api/organizations/:orgId/invoices',
    {
      preHandler: [requireRole(['owner', 'admin'])],
      schema: {
        tags: ['billing'],
        summary: 'List invoices for an organization',
        params: {
          type: 'object',
          properties: { orgId: { type: 'string' } },
          required: ['orgId'],
        },
        response: {
          200: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                plan: { type: 'string' },
                amount: { type: 'integer' },
                currency: { type: 'string' },
                status: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
                paidAt: { type: ['string', 'null'] },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };

      const invoices = await prisma.invoice.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          plan: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          paidAt: true,
        },
      });

      return reply.send(invoices);
    },
  );
}

// ─── POST /api/billing/webhook/:provider ──────────────────────────────────

async function webhookHandler(app: FastifyInstance) {
  app.post(
    '/api/billing/webhook/:provider',
    {
      schema: {
        tags: ['billing'],
        summary: 'Handle payment webhook callbacks (alipay/stripe)',
        params: {
          type: 'object',
          properties: { provider: { type: 'string', enum: ['alipay', 'stripe'] } },
          required: ['provider'],
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { provider } = request.params as { provider: 'alipay' | 'stripe' };
      const body = request.body as Record<string, unknown>;

      // Verify webhook signature
      const secret = provider === 'alipay'
        ? process.env.ALIPAY_WEBHOOK_SECRET ?? ''
        : process.env.STRIPE_WEBHOOK_SECRET ?? '';

      if (secret) {
        const signature = (request.headers['x-webhook-signature'] as string) ?? '';
        const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
        if (signature !== expected) {
          return reply.code(401).send({ error: 'Invalid webhook signature' });
        }
      }

      // Process payment event
      const invoiceId = (body.invoice_id as string) ?? (body.id as string) ?? '';
      const eventType = (body.type as string) ?? 'payment.completed';

      if (eventType.includes('payment') || eventType.includes('completed')) {
        const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
        if (invoice) {
          await prisma.invoice.update({
            where: { id: invoiceId },
            data: { status: 'paid', paidAt: new Date() },
          });
          await prisma.subscription.update({
            where: { organizationId: invoice.organizationId },
            data: { status: 'active' },
          });
        }
      }

      return reply.send({ received: true });
    },
  );
}

// ─── Module registration ──────────────────────────────────────────────────

export async function registerBillingModule(app: FastifyInstance) {
  await getSubscription(app);
  await subscribe(app);
  await getInvoices(app);
  await webhookHandler(app);
}
