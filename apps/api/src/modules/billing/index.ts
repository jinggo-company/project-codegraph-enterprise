/**
 * Billing & Subscription Module — CodeGraph Enterprise (F7)
 *
 * Manages subscription plans, upgrades/downgrades, payment webhooks
 * (WeChat Pay / Alipay / Stripe), invoice queries, and usage enforcement.
 *
 * Routes:
 *   GET    /api/organizations/:orgId/subscription
 *   POST   /api/billing/subscribe                    — 升级/降级套餐
 *   POST   /api/billing/cancel-subscription          — 取消订阅
 *   GET    /api/organizations/:orgId/invoices
 *   POST   /api/billing/webhook/:provider            — 支付回调 (wechat/alipay/stripe)
 *   GET    /api/organizations/:orgId/usage           — 当前用量统计
 *   POST   /api/billing/payment-intent               — 创建支付意向
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '@codegraph/db';
import { logAudit } from '../audit/index.js';
import { createHmac } from 'node:crypto';

// ─── Plan definitions ─────────────────────────────────────────────────────

export const PLANS = {
  free: {
    projectLimit: 3,
    memberLimit: 5,
    maxSymbols: 10_000,
    maxConcurrentBuilds: 1,
    price: 0,
    features: ['basic indexing', 'manual builds'],
  },
  pro: {
    projectLimit: 20,
    memberLimit: 50,
    maxSymbols: 500_000,
    maxConcurrentBuilds: 3,
    price: 9900, // ¥99/month (in cents)
    features: ['everything in free', 'CI/CD auto builds', 'audit logs', 'WeCom/DingTalk notifications'],
  },
  enterprise: {
    projectLimit: -1, // unlimited
    memberLimit: -1,
    maxSymbols: -1,
    maxConcurrentBuilds: 10,
    price: -1, // custom pricing
    features: ['everything in pro', 'unlimited projects', 'priority support', 'SLA'],
  },
} as const;

export type PlanName = keyof typeof PLANS;

/** Plan upgrade order for downgrade validation */
const PLAN_ORDER: PlanName[] = ['free', 'pro', 'enterprise'];

function planRank(plan: PlanName): number {
  return PLAN_ORDER.indexOf(plan);
}

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

// ─── Payment provider helpers ───────────────────────────────────────────────

/**
 * Create a WeChat Pay unified order request body.
 * Ref: https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_1_1
 */
function buildWeChatPayBody(
  invoiceId: string,
  amountCents: number,
  description: string,
  notifyUrl: string,
): Record<string, unknown> {
  return {
    appid: process.env.WECHAT_PAY_APP_ID,
    mchid: process.env.WECHAT_PAY_MCH_ID,
    description,
    out_trade_no: invoiceId,
    notify_url: notifyUrl,
    amount: {
      total: amountCents,
      currency: 'CNY',
    },
  };
}

/**
 * Create an Alipay pre-create request body (QR code payment).
 * Ref: https://opendocs.alipay.com/open/02fkau
 */
function buildAlipayBody(
  invoiceId: string,
  amountCents: number,
  subject: string,
): Record<string, unknown> {
  return {
    out_trade_no: invoiceId,
    total_amount: (amountCents / 100).toFixed(2),
    subject,
  };
}

// ─── Usage enforcement middleware helper ────────────────────────────────────

/**
 * Check if an organization has reached its subscription limits.
 * Returns { canCreate, limit, current, limitType } where canCreate=false means blocked.
 */
export async function checkUsageLimit(
  organizationId: string,
  limitType: 'projects' | 'members',
): Promise<{ canCreate: boolean; limit: number; current: number; plan: PlanName }> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId } });
  const planKey = fromPrismaPlan(sub?.plan ?? 'FREE');
  const plan = PLANS[planKey];

  const current =
    limitType === 'projects'
      ? await prisma.project.count({ where: { team: { organizationId } } })
      : await prisma.member.count({ where: { team: { organization: { id: organizationId } } } });

  const limit = limitType === 'projects' ? plan.projectLimit : plan.memberLimit;

  return {
    canCreate: limit < 0 || current < limit,
    limit,
    current,
    plan: planKey,
  };
}

// ─── Module registration ──────────────────────────────────────────────────

export async function registerBillingModule(app: FastifyInstance) {
  // ─── GET /api/organizations/:orgId/subscription ─────────────────────────
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
        memberLimit: plan.memberLimit,
        maxSymbols: plan.maxSymbols,
        maxConcurrentBuilds: plan.maxConcurrentBuilds,
        price: plan.price,
        features: plan.features,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      });
    },
  );

  // ─── GET /api/organizations/:orgId/usage ────────────────────────────────
  app.get(
    '/api/organizations/:orgId/usage',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;

      const [projectCount, memberCount] = await Promise.all([
        prisma.project.count({ where: { team: { organizationId: orgId } } }),
        prisma.member.count({ where: { team: { organization: { id: orgId } } } }),
      ]);

      const sub = await prisma.subscription.findUnique({ where: { organizationId: orgId } });
      const planKey = fromPrismaPlan(sub?.plan ?? 'FREE');
      const plan = PLANS[planKey];

      return reply.send({
        plan: planKey,
        projects: { current: projectCount, limit: plan.projectLimit, percent: plan.projectLimit > 0 ? Math.round((projectCount / plan.projectLimit) * 100) : 0 },
        members: { current: memberCount, limit: plan.memberLimit, percent: plan.memberLimit > 0 ? Math.round((memberCount / plan.memberLimit) * 100) : 0 },
      });
    },
  );

  // ─── POST /api/billing/subscribe ────────────────────────────────────────
  app.post(
    '/api/billing/subscribe',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { organizationId, plan, paymentMethod } = request.body as {
        organizationId: string;
        plan: PlanName;
        paymentMethod?: 'wechat' | 'alipay' | 'stripe';
      };

      if (!organizationId || !plan || !PLANS[plan]) {
        return reply.code(400).send({ error: 'Invalid request: missing organizationId or plan' });
      }

      // Get current subscription
      const currentSub = await prisma.subscription.findUnique({ where: { organizationId } });
      const currentPlan = fromPrismaPlan(currentSub?.plan ?? 'FREE');

      // ── Downgrade validation ──
      if (planRank(plan) < planRank(currentPlan)) {
        const targetPlan = PLANS[plan];
        const projectCount = await prisma.project.count({
          where: { team: { organizationId } },
        });
        const memberCount = await prisma.member.count({
          where: { team: { organization: { id: organizationId } } },
        });

        if (targetPlan.projectLimit >= 0 && projectCount > targetPlan.projectLimit) {
          return reply.code(422).send({
            error: `Cannot downgrade to ${plan}: current project count (${projectCount}) exceeds limit (${targetPlan.projectLimit}). Remove projects first.`,
            currentCount: projectCount,
            targetLimit: targetPlan.projectLimit,
          });
        }
        if (targetPlan.memberLimit >= 0 && memberCount > targetPlan.memberLimit) {
          return reply.code(422).send({
            error: `Cannot downgrade to ${plan}: current member count (${memberCount}) exceeds limit (${targetPlan.memberLimit}). Remove members first.`,
            currentCount: memberCount,
            targetLimit: targetPlan.memberLimit,
          });
        }
      }

      // ── Free plan: instant switch ──
      if (plan === 'free') {
        await prisma.subscription.upsert({
          where: { organizationId },
          update: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
          create: { organizationId, plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null },
        });

        await logAudit({
          userId: request.user?.id ?? 'unknown',
          action: 'PLAN_DOWNGRADE',
          entityType: 'subscription',
          entityId: organizationId,
          organizationId,
          details: { from: currentPlan, to: 'free' },
        });

        return reply.send({ success: true, plan: 'free', redirectUrl: null, invoiceId: null });
      }

      // ── Paid plan: create invoice and payment intent ──
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
          provider: paymentMethod ?? 'alipay',
        },
      });

      // Update subscription immediately (optimistic), will confirm on payment webhook
      await prisma.subscription.upsert({
        where: { organizationId },
        update: { plan: planEnum, status: 'ACTIVE', currentPeriodEnd },
        create: { organizationId, plan: planEnum, status: 'ACTIVE', currentPeriodEnd },
      });

      const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
      const notifyUrl = `${baseUrl}/api/billing/webhook/${paymentMethod ?? 'alipay'}`;

      let redirectUrl: string | null = null;

      if (paymentMethod === 'wechat') {
        // WeChat Pay: create unified order
        const wxBody = buildWeChatPayBody(invoice.id, planDef.price, `CodeGraph Enterprise ${plan} plan`, notifyUrl);
        redirectUrl = `/api/billing/payment-intent/wechat?invoice=${invoice.id}`;
        // In production, call WeChat Pay API v3 and return the QR code / prepay_id
      } else if (paymentMethod === 'alipay') {
        redirectUrl = `https://openapi.alipay.com/gateway.do?out_trade_no=${invoice.id}&total_amount=${(planDef.price / 100).toFixed(2)}&subject=CodeGraph+Enterprise+${plan}`;
      } else {
        // Stripe fallback
        redirectUrl = `https://checkout.stripe.com/pay?invoice=${invoice.id}`;
      }

      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: planRank(plan) > planRank(currentPlan) ? 'PLAN_UPGRADE' : 'UPDATE_SUBSCRIPTION',
        entityType: 'subscription',
        entityId: organizationId,
        organizationId,
        details: { invoiceId: invoice.id, paymentMethod, from: currentPlan, to: plan },
      });

      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: 'PAYMENT_INITIATED',
        entityType: 'invoice',
        entityId: invoice.id,
        organizationId,
        details: { amount: planDef.price, provider: paymentMethod },
      });

      return reply.send({ success: true, plan, redirectUrl, invoiceId: invoice.id });
    },
  );

  // ─── POST /api/billing/cancel-subscription ──────────────────────────────
  app.post(
    '/api/billing/cancel-subscription',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { organizationId } = request.body as { organizationId: string };

      const sub = await prisma.subscription.findUnique({ where: { organizationId } });
      if (!sub) {
        return reply.code(404).send({ error: 'No subscription found' });
      }

      await prisma.subscription.update({
        where: { organizationId },
        data: { cancelAtPeriodEnd: true, status: 'CANCELED' },
      });

      await logAudit({
        userId: request.user?.id ?? 'unknown',
        action: 'UPDATE_SUBSCRIPTION',
        entityType: 'subscription',
        entityId: organizationId,
        organizationId,
        details: { action: 'cancel_subscription' },
      });

      return reply.send({ success: true, message: 'Subscription will be canceled at the end of the current period' });
    },
  );

  // ─── GET /api/organizations/:orgId/invoices ─────────────────────────────
  app.get(
    '/api/organizations/:orgId/invoices',
    { preHandler: [app.authenticate as any] },
    async (request: any, reply) => {
      const { orgId } = request.params;
      const { page = '1', limit = '20', status } = request.query as Record<string, string>;

      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { organizationId: orgId };
      if (status) where.status = status.toUpperCase();

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (pageNum - 1) * limitNum,
          take: limitNum,
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            provider: true,
            providerRef: true,
            createdAt: true,
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      return reply.send({ data: invoices, total, page: pageNum, limit: limitNum });
    },
  );

  // ─── POST /api/billing/webhook/:provider ────────────────────────────────
  app.post(
    '/api/billing/webhook/:provider',
    {},
    async (request: any, reply) => {
      const { provider } = request.params as { provider: 'wechat' | 'alipay' | 'stripe' };
      const body = request.body as Record<string, unknown>;
      const headers = request.headers as Record<string, string>;

      // ── Verify webhook signature ──
      const verified = await (() => {
        if (provider === 'alipay') {
          const secret = process.env.ALIPAY_WEBHOOK_SECRET;
          if (!secret) return true; // no secret configured, skip verification
          const signature = headers['x-webhook-signature'] ?? '';
          const expected = createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
          return signature === expected;
        }
        if (provider === 'wechat') {
          // WeChat Pay v3 uses signature in header
          const signature = headers['wechatpay-signature'] ?? '';
          const serial = headers['wechatpay-serial'] ?? '';
          const timestamp = headers['wechatpay-timestamp'] ?? '';
          const nonce = headers['wechatpay-nonce'] ?? '';
          // In production, verify with WeChat Pay public key certificate
          if (!process.env.WECHAT_PAY_WEBHOOK_SECRET) return true;
          const secret = process.env.WECHAT_PAY_WEBHOOK_SECRET;
          const bodyStr = `${timestamp}\n${nonce}\n${JSON.stringify(body)}\n`;
          const expected = createHmac('sha256', secret).update(bodyStr).digest('base64');
          return signature === expected;
        }
        // Stripe
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return true;
        const signature = headers['stripe-signature'] ?? '';
        return signature.length > 0; // simplified; use stripe SDK in production
      })();

      if (!verified) {
        return reply.code(401).send({ error: 'Invalid webhook signature' });
      }

      // ── Extract invoice ID and event type ──
      let invoiceId = '';
      let eventType = '';
      let tradeStatus = '';

      if (provider === 'wechat') {
        // WeChat Pay v3 callback format
        const resource = (body.resource as Record<string, unknown>) ?? {};
        invoiceId = (resource.out_trade_no as string) ?? (body.out_trade_no as string) ?? '';
        tradeStatus = (resource.trade_state as string) ?? (body.trade_state as string) ?? '';
        eventType = tradeStatus === 'SUCCESS' ? 'payment.completed' : 'payment.failed';
      } else if (provider === 'alipay') {
        invoiceId = (body.out_trade_no as string) ?? (body.invoice_id as string) ?? (body.id as string) ?? '';
        tradeStatus = (body.trade_status as string) ?? '';
        eventType = tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED'
          ? 'payment.completed'
          : 'payment.failed';
      } else {
        invoiceId = (body.invoice_id as string) ?? (body.id as string) ?? '';
        eventType = (body.type as string) ?? 'payment.completed';
      }

      if (!invoiceId) {
        return reply.send({ received: true, ignored: true, reason: 'no invoice_id' });
      }

      // ── Process payment completion ──
      if (eventType.includes('payment') && (eventType.includes('completed') || tradeStatus === 'SUCCESS' || tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED')) {
        const invoice = await prisma.invoice.findFirst({
          where: { OR: [{ id: invoiceId }, { providerRef: invoiceId }] },
          include: { organization: true },
        });

        if (invoice) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'PAID', providerRef: invoice.providerRef ?? invoiceId, paidAt: new Date() },
          });

          await prisma.subscription.update({
            where: { organizationId: invoice.organizationId },
            data: { status: 'ACTIVE' },
          });

          await logAudit({
            userId: 'system',
            action: 'PAYMENT_COMPLETED',
            entityType: 'invoice',
            entityId: invoice.id,
            organizationId: invoice.organizationId,
            details: { provider, invoiceId, tradeStatus },
          });
        }
      }

      // ── Process payment failure ──
      if (eventType.includes('failed') || tradeStatus === 'CLOSED' || tradeStatus === 'REVOKED') {
        const invoice = await prisma.invoice.findFirst({
          where: { OR: [{ id: invoiceId }, { providerRef: invoiceId }] },
        });
        if (invoice) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'FAILED' },
          });

          await prisma.subscription.update({
            where: { organizationId: invoice.organizationId },
            data: { status: 'PAST_DUE' },
          });
        }
      }

      return reply.send({ received: true });
    },
  );
}
