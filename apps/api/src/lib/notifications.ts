// Notification service — WeCom (企微) & DingTalk (钉钉) webhook notifications
// F8: 索引构建通知、权限审批流程、用量告警推送
import { prisma } from '@codegraph/db';

// ─── Types ────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  /** Notification type */
  type:
    | 'index:completed'
    | 'index:failed'
    | 'usage:warning'
    | 'approval:request';
  projectId: string;
  projectName: string;
  indexId?: string;
  status?: string;
  error?: string;
  duration?: number;
  stats?: { files: number; symbols: number };
  /** Org ID for audit logging */
  organizationId?: string;
  /** Approval-specific fields */
  approvalRequester?: string;
  approvalRole?: string;
  approvalTarget?: string;
  /** Usage warning fields */
  usagePercent?: number;
  usageLimit?: number;
  usageCurrent?: number;
}

/** Channel config (stored per org in DB or env) */
export interface ChannelConfig {
  platform: 'wecom' | 'dingtalk';
  webhookUrl: string;
  /** DingTalk HMAC sign secret (optional) */
  signSecret?: string;
  /** Only send these event types */
  eventFilter?: string[];
}

// ─── Per-channel senders ──────────────────────────────────────────────────

/**
 * Send a message to a WeCom group via webhook bot.
 * Ref: https://developer.work.weixin.qq.com/document/path/91770
 */
async function sendWeComNotification(payload: NotificationPayload): Promise<boolean> {
  const webhookUrl = process.env.WECOM_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const {
    type, projectName, projectId, status, error, duration, stats,
    usagePercent, usageCurrent, usageLimit, approvalRequester, approvalRole, approvalTarget,
  } = payload;

  let title: string;
  let content: string;

  if (type === 'index:completed') {
    title = `✅ 索引构建成功`;
    content = `**${title}**\n> 项目: ${projectName} (${projectId})\n> 状态: ${status ?? 'COMPLETED'}\n`;
    if (duration !== undefined) content += `> 耗时: ${duration}ms\n`;
    if (stats) content += `> 文件数: ${stats.files}, 符号数: ${stats.symbols}\n`;
  } else if (type === 'index:failed') {
    title = `❌ 索引构建失败`;
    content = `**${title}**\n> 项目: ${projectName} (${projectId})\n> 状态: ${status ?? 'FAILED'}\n`;
    if (error) content += `> 错误: ${error}\n`;
  } else if (type === 'usage:warning') {
    title = `⚠️ 用量告警`;
    content = `**${title}**\n> 项目: ${projectName}\n> 当前用量: ${usagePercent ?? 0}%\n`;
    if (usageCurrent !== undefined && usageLimit !== undefined) {
      content += `> 已用: ${usageCurrent} / ${usageLimit}\n`;
    }
    content += `> 请尽快升级套餐以避免服务中断。\n`;
  } else if (type === 'approval:request') {
    title = `📋 审批请求`;
    content = `**${title}**\n> 项目: ${projectName} (${projectId})\n> 请求人: ${approvalRequester ?? 'N/A'}\n`;
    if (approvalRole) content += `> 请求角色: ${approvalRole}\n`;
    if (approvalTarget) content += `> 审批目标: ${approvalTarget}\n`;
    content += `> 请登录管理控制台进行审批。\n`;
  } else {
    title = `通知`;
    content = `**${title}**\n> 项目: ${projectName} (${projectId})\n`;
  }

  const body = {
    msgtype: 'markdown' as const,
    markdown: { content },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { errcode: number; errmsg: string };
    return data.errcode === 0;
  } catch {
    return false;
  }
}

/**
 * Send a message to a DingTalk group via custom robot webhook.
 * Ref: https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages
 */
async function sendDingTalkNotification(payload: NotificationPayload): Promise<boolean> {
  let webhookUrl = process.env.DINGTALK_WEBHOOK_URL;
  const signSecret = process.env.DINGTALK_SECRET;

  if (!webhookUrl) return false;

  // Append HMAC signature if secret is configured
  if (signSecret) {
    const timestamp = Date.now();
    const { createHmac } = await import('node:crypto');
    const stringToSign = `${timestamp}\n${signSecret}`;
    const sign = encodeURIComponent(
      createHmac('sha256', signSecret).update(stringToSign).digest('base64'),
    );
    const sep = webhookUrl.includes('?') ? '&' : '?';
    webhookUrl = `${webhookUrl}${sep}timestamp=${timestamp}&sign=${sign}`;
  }

  const {
    type, projectName, projectId, status, error, duration, stats,
    usagePercent, usageCurrent, usageLimit, approvalRequester, approvalRole, approvalTarget,
  } = payload;

  let title: string;
  let text: string;

  if (type === 'index:completed') {
    title = `✅ 索引构建成功`;
    text = `# ${title}\n\n- **项目**: ${projectName} (${projectId})\n- **状态**: ${status ?? 'COMPLETED'}\n`;
    if (duration !== undefined) text += `- **耗时**: ${duration}ms\n`;
    if (stats) text += `- **文件数**: ${stats.files}, **符号数**: ${stats.symbols}\n`;
  } else if (type === 'index:failed') {
    title = `❌ 索引构建失败`;
    text = `# ${title}\n\n- **项目**: ${projectName} (${projectId})\n- **状态**: ${status ?? 'FAILED'}\n`;
    if (error) text += `- **错误**: ${error}\n`;
  } else if (type === 'usage:warning') {
    title = `⚠️ 用量告警`;
    text = `# ${title}\n\n- **项目**: ${projectName}\n- **当前用量**: ${usagePercent ?? 0}%\n`;
    if (usageCurrent !== undefined && usageLimit !== undefined) {
      text += `- **已用**: ${usageCurrent} / ${usageLimit}\n`;
    }
    text += `- **提示**: 请尽快升级套餐以避免服务中断。\n`;
  } else if (type === 'approval:request') {
    title = `📋 审批请求`;
    text = `# ${title}\n\n- **项目**: ${projectName} (${projectId})\n- **请求人**: ${approvalRequester ?? 'N/A'}\n`;
    if (approvalRole) text += `- **请求角色**: ${approvalRole}\n`;
    if (approvalTarget) text += `- **审批目标**: ${approvalTarget}\n`;
    text += `- **操作**: 请登录管理控制台进行审批。\n`;
  } else {
    title = `通知`;
    text = `# ${title}\n\n- **项目**: ${projectName} (${projectId})\n`;
  }

  const body = {
    msgtype: 'markdown' as const,
    markdown: { title, text },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { errcode: number; errmsg: string };
    return data.errcode === 0;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Send notification to all configured channels (WeCom + DingTalk).
 * Returns a record of which channels succeeded.
 * Also writes an audit log if organizationId is provided.
 */
export async function sendIndexNotification(
  payload: NotificationPayload,
): Promise<{ wecom: boolean; dingtalk: boolean }> {
  const [wecom, dingtalk] = await Promise.allSettled([
    sendWeComNotification(payload),
    sendDingTalkNotification(payload),
  ]);

  const wecomOk = wecom.status === 'fulfilled' && wecom.value;
  const dingtalkOk = dingtalk.status === 'fulfilled' && dingtalk.value;

  // Write audit log for notification
  if (payload.organizationId) {
    try {
      await prisma.auditLog.create({
        data: {
          organizationId: payload.organizationId,
          userId: 'system',
          action: 'NOTIFICATION_SENT',
          entityType: 'notification',
          entityId: payload.indexId ?? payload.projectId,
          details: {
            type: payload.type,
            projectId: payload.projectId,
            projectName: payload.projectName,
            channels: { wecom: wecomOk, dingtalk: dingtalkOk },
            error: payload.error,
          },
        },
      });
    } catch {
      // Audit write failure should not block the notification result
    }
  }

  return { wecom: wecomOk, dingtalk: dingtalkOk };
}

/**
 * Send a usage warning when subscription usage exceeds a threshold.
 * Called from middleware that checks project/member counts.
 */
export async function sendUsageWarning(
  organizationId: string,
  projectName: string,
  projectId: string,
  usagePercent: number,
  usageCurrent: number,
  usageLimit: number,
): Promise<{ wecom: boolean; dingtalk: boolean }> {
  return sendIndexNotification({
    type: 'usage:warning',
    organizationId,
    projectName,
    projectId,
    status: 'WARNING',
    usagePercent,
    usageCurrent,
    usageLimit,
  });
}

/**
 * Send an approval request to admins.
 */
export async function sendApprovalRequest(
  organizationId: string,
  projectName: string,
  projectId: string,
  requester: string,
  role: string,
  target: string,
): Promise<{ wecom: boolean; dingtalk: boolean }> {
  return sendIndexNotification({
    type: 'approval:request',
    organizationId,
    projectName,
    projectId,
    approvalRequester: requester,
    approvalRole: role,
    approvalTarget: target,
  });
}
