// Notification service — WeCom (企微) & DingTalk (钉钉) webhook notifications
// AC-10: 索引构建成功/失败推送消息到指定群

interface NotificationPayload {
  type: 'index:completed' | 'index:failed';
  projectId: string;
  projectName: string;
  indexId: string;
  status: string;
  error?: string;
  duration?: number;
  stats?: { files: number; symbols: number };
}

/**
 * Send a message to a WeCom group via webhook bot.
 *
 * Environment: WECOM_WEBHOOK_URL (optional — if unset, calls are no-op)
 * Ref: https://developer.work.weixin.qq.com/document/path/91770
 */
async function sendWeComNotification(payload: NotificationPayload): Promise<boolean> {
  const webhookUrl = process.env.WECOM_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const { type, projectName, projectId, status, error, duration } = payload;

  const emoji = type === 'index:completed' ? '✅' : '❌';
  const title = `${emoji} Index ${type === 'index:completed' ? 'Success' : 'Failed'}`;

  let content = `**${title}**\n`;
  content += `> Project: ${projectName} (${projectId})\n`;
  content += `> Status: ${status}\n`;
  if (duration !== undefined) {
    content += `> Duration: ${duration}ms\n`;
  }
  if (error) {
    content += `> Error: ${error}\n`;
  }

  const body = {
    msgtype: 'markdown' as const,
    markdown: {
      content,
    },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { errcode: number; errmsg: string };
    return data.errcode === 0;
  } catch {
    return false;
  }
}

/**
 * Send a message to a DingTalk group via custom robot webhook.
 *
 * Environment: DINGTALK_WEBHOOK_URL (optional — if unset, calls are no-op)
 *              DINGTALK_SECRET (optional — sign secret for security)
 * Ref: https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages
 */
async function sendDingTalkNotification(payload: NotificationPayload): Promise<boolean> {
  const webhookUrl = process.env.DINGTALK_WEBHOOK_URL;
  if (!webhookUrl) return false;

  const { type, projectName, projectId, status, error, duration } = payload;

  const emoji = type === 'index:completed' ? '✅' : '❌';
  const title = `${emoji} 索引构建${type === 'index:completed' ? '成功' : '失败'}`;

  let text = `# ${title}\n\n`;
  text += `- **项目**: ${projectName} (${projectId})\n`;
  text += `- **状态**: ${status}\n`;
  if (duration !== undefined) {
    text += `- **耗时**: ${duration}ms\n`;
  }
  if (error) {
    text += `- **错误**: ${error}\n`;
  }

  const body = {
    msgtype: 'markdown' as const,
    markdown: {
      title,
      text,
    },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json() as { errcode: number; errmsg: string };
    return data.errcode === 0;
  } catch {
    return false;
  }
}

/**
 * Send notification to all configured channels (WeCom + DingTalk).
 * Returns a record of which channels succeeded.
 */
export async function sendIndexNotification(payload: NotificationPayload): Promise<{ wecom: boolean; dingtalk: boolean }> {
  const [wecom, dingtalk] = await Promise.all([
    sendWeComNotification(payload),
    sendDingTalkNotification(payload),
  ]);
  return { wecom, dingtalk };
}
