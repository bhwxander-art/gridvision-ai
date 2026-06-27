import "server-only";

interface SlackPayload {
  webhookUrl: string;
  text: string;
  blocks?: unknown[];
}

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendSlackNotification(payload: SlackPayload): Promise<SendResult> {
  try {
    const body = JSON.stringify(
      payload.blocks
        ? { text: payload.text, blocks: payload.blocks }
        : { text: payload.text }
    );

    const res = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/slack] Send failed:", msg);
    return { ok: false, error: msg };
  }
}

export function buildSlackGridAlert(opts: {
  headline: string;
  body: string;
  severity: "info" | "warning" | "critical";
  appUrl?: string;
}): unknown[] {
  const emojis = { info: "ℹ️", warning: "⚠️", critical: "🚨" };
  const colors = { info: "#22d3ee", warning: "#f59e0b", critical: "#ef4444" };

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emojis[opts.severity]} *${opts.headline}*\n${opts.body}`,
      },
    },
    ...(opts.appUrl
      ? [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "View in GridVision AI" },
                url: opts.appUrl,
                style: "primary",
              },
            ],
          },
        ]
      : []),
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `⚡ GridVision AI · <${colors[opts.severity]}|${opts.severity.toUpperCase()}>`,
        },
      ],
    },
  ];
}
