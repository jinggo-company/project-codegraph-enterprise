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

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codegraph/db';
import { logAudit } from '../audit/index.js';
import { createHmac } from 'node:crypto';

// ─── Plan definitions ─────────────────────────────────────────────────────

export const PLANS = {
  free: { projectLimit: 3, maxSymbols: 10000, price: 0 },
  pro: { projectLimit: 20, maxSymbols: 500000, price: 9900 },
  enterprise: { projectLimit: -1, maxSymbols: -1, price: -1 },
} as const;

export type PlanName = keyof typeof PLANS;

function toPrismaPlan(name: PlanName): 'FREE' | 'PRO' | 'ENTERPRISE' {
  if (name === 'free') return 'FREE';
  if (name === 'pro') return 'PRO';
  return 'ENTERPRISE';
}

function fromPrismaPlan(plan: string): PlanName {
  if (plan === 'PRO') return 'pro';
  if (plan === 'ENTERPRISE') return 'enterprise';
  return 'free';
}

// ─── Module registration ──────────────────────────────────────────────────

export async function registerBillingModule(app: FastifyInstance) {
  // GET /api/organizations/:orgId/subscription
  app.get(
    '/api/organizations/:orgId/subscription',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
      const planKey = fromPrismaPlan(sub?.plan ?? 'FREE');
      const plan = PLANS[planKey];

      return reply.send({
        plan: planKey,
        status: sub?.status ?? 'ACTIVE',
        expiresAt: sub?.currentPeriodEnd?.toISOString() ?? null,
        projectLimit: plan.projectLimit,
        maxSymbols: plan.maxSymbols,
        price: plan.price,
      });
    },
  );

  // POST /api/billing/subscribe
  app.post(
    '/api/billing/subscribe',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { organizationId, plan, paymentMethod } = request.body as {
        organizationId: string;
        plan: PlanName;
        paymentMethod?: 'alipay' | 'stripe';
      };

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

      if (plan === 'free') {
        await prisma.subscription.upsert({
          where: { organizationId },
          update: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
          create: { organizationId, plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
        });
        return reply.send({ success: true, plan: 'free', redirectUrl: null });
      }

      const planDef = PLANS[plan];
      const planEnum = toPrismaPlan(plan);
      const currentPeriodEnd = new Date();
      currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

      const invoice = await prisma.invoice.create({
        data: {
          organizationId,
          amount: planDef.price,
          currency: 'CNY',
          status: 'PENDING',
          provider: paymentMethod ?? undefined,
        },
      });

      await prisma.subscription.upsert({
        where: { organizationId },
        update: { plan: planEnum, status: 'ACTIVE', currentPeriodEnd },
        create: { organizationId, plan: planEnum, status: 'ACTIVE', currentPeriodEnd },
      });

      const redirectUrl = paymentMethod === 'alipay'
        ? `https://openapi.alipay.com/gateway.do?invoice=${invoice.id}`
        : `https://checkout.stripe.com/pay?invoice=${invoice.id}`;

      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: 'UPDATE_SUBSCRIPTION',
        entityType: 'subscription',
        entityId: organizationId,
        organizationId,
        details: { invoiceId: invoice.id, paymentMethod },
      });

      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: 'PAYMENT_INITIATED',
        entityType: 'invoice',
        entityId: invoice.id,
        organizationId,
        details: { amount: planDef.price, provider: paymentMethod },
      });

      return reply.send({ success: true, plan, redirectUrl });
    },
  );

  // GET /api/organizations/:orgId/invoices
  app.get(
    '/api/organizations/:orgId/invoices',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;

      const invoices = await prisma.invoice.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          amount: true,
          currency: true,
          status: true,
          createdAt: true,
          provider: true,
          providerRef: true,
        },
      });

      return reply.send(invoices);
    },
  );

  // POST /api/billing/webhook/:provider
  app.post(
    '/api/billing/webhook/:provider',
    {},
    async (request: any, reply) => {
      const { provider } = request.params as { provider: 'alipay' | 'stripe' };
      const body = request.body as Record<string, unknown>;

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

      const invoiceId = (body.invoice_id as string) ?? (body.id as string) ?? '';
      const eventType = (body.type as string) ?? 'payment.completed';

      if (eventType.includes('payment') || eventType.includes('completed')) {
        const invoice = await prisma.invoice.findFirst({
          where: { OR: [{ id: invoiceId }, { providerRef: invoiceId }] },
        });
        if (invoice) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID', providerRef: invoice.providerRef ?? invoiceId },
          });
          await prisma.subscription.update({
            where: { organizationId: invoice.organizationId },
            data: { status: 'ACTIVE' },
          });
        }
      }

      return reply.send({ received: true });
    },
  );
}
