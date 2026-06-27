import "server-only";

interface TeamsPayload {
  webhookUrl: string;
  title: string;
  text: string;
  themeColor?: string;
  actionUrl?: string;
  actionLabel?: string;
}

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendTeamsNotification(payload: TeamsPayload): Promise<SendResult> {
  try {
    const card = {
      "@type": "MessageCard",
      "@context": "http://schema.org/extensions",
      themeColor: payload.themeColor ?? "0078D4",
      summary: payload.title,
      sections: [
        {
          activityTitle: `⚡ **${payload.title}**`,
          activityText: payload.text,
        },
      ],
      ...(payload.actionUrl
        ? {
            potentialAction: [
              {
                "@type": "OpenUri",
                name: payload.actionLabel ?? "View in GridVision AI",
                targets: [{ os: "default", uri: payload.actionUrl }],
              },
            ],
          }
        : {}),
    };

    const res = await fetch(payload.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => `HTTP ${res.status}`);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}
