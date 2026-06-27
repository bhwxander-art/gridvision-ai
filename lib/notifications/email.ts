import "server-only";

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "notifications@gridvision.ai";

  if (!apiKey) {
    console.warn("[notifications/email] RESEND_API_KEY not configured — email not sent");
    return { ok: false, error: "Email not configured" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: fromEmail,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    });

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications/email] Send failed:", msg);
    return { ok: false, error: msg };
  }
}

export function buildGridAlertEmail(opts: {
  tenantName: string;
  subject: string;
  headline: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${opts.subject}</title></head>
<body style="margin:0;padding:0;background:#0d1219;font-family:sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px;">
      <span style="font-size:18px;font-weight:700;color:#22d3ee;">&#9889; GridVision AI</span>
    </div>
    <div style="background:#131b26;border:1px solid #1e2d3d;border-radius:12px;padding:24px;">
      <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;">${opts.tenantName}</p>
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#f1f5f9;">${opts.headline}</h1>
      <p style="margin:0;font-size:14px;line-height:1.6;color:#94a3b8;">${opts.body}</p>
      ${opts.actionUrl ? `
      <div style="margin-top:24px;">
        <a href="${opts.actionUrl}" style="display:inline-block;background:#22d3ee;color:#0d1219;font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;text-decoration:none;">${opts.actionLabel ?? "View Details"}</a>
      </div>` : ""}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#475569;text-align:center;">GridVision AI &middot; Grid Intelligence Platform</p>
  </div>
</body>
</html>`;
}
