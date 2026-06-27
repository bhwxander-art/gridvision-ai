import "server-only";
import { getServerClient, isDbConfigured } from "@/lib/db/client";
import { TenantRepository } from "@/lib/db/repositories/tenant.repository";
import { sendEmail, buildGridAlertEmail } from "./email";
import { sendSlackNotification, buildSlackGridAlert } from "./slack";
import { sendTeamsNotification } from "./teams";

export type NotificationEventType =
  | "data_stale"
  | "project_update"
  | "account_update"
  | "health_alert"
  | "capacity_warning"
  | "import_complete";

export interface NotificationEvent {
  tenantId: string;
  eventType: NotificationEventType;
  headline: string;
  body: string;
  severity: "info" | "warning" | "critical";
  appUrl?: string;
}

export async function dispatchNotification(event: NotificationEvent): Promise<void> {
  if (!isDbConfigured()) return;

  const client = getServerClient();
  const tenantRepo = new TenantRepository(client);

  let settings: Record<string, unknown>;
  try {
    const tenant = await tenantRepo.getTenant(event.tenantId);
    settings = (tenant?.settings as Record<string, unknown>) ?? {};
  } catch {
    return;
  }

  const notificationPrefs =
    (settings.notificationPreferences as Record<string, unknown>) ?? {};
  const notificationEmail = settings.notificationEmail as string | undefined;
  const slackWebhookUrl = notificationPrefs.slackWebhookUrl as string | undefined;
  const teamsWebhookUrl = notificationPrefs.teamsWebhookUrl as string | undefined;

  const shouldSendEmail =
    (event.eventType === "data_stale" && notificationPrefs.emailOnDataStale) ||
    (event.eventType === "project_update" && notificationPrefs.emailOnProjectUpdate) ||
    (event.eventType === "account_update" && notificationPrefs.emailOnAccountUpdate) ||
    (event.eventType === "health_alert" && notificationPrefs.emailOnHealthAlert) ||
    (event.eventType === "capacity_warning" && notificationPrefs.emailOnCapacityWarning) ||
    (event.eventType === "import_complete" && notificationPrefs.emailOnImportComplete);

  const tenantName = (settings.companyName as string) ?? "GridVision AI";
  const logPromises: Promise<void>[] = [];

  // Email
  if (shouldSendEmail && notificationEmail) {
    const html = buildGridAlertEmail({
      tenantName,
      subject: event.headline,
      headline: event.headline,
      body: event.body,
      actionUrl: event.appUrl,
    });

    logPromises.push(
      sendEmail({ to: notificationEmail, subject: event.headline, html }).then(
        async (result) => {
          await client
            .from("notification_log")
            .insert({
              tenant_id: event.tenantId,
              event_type: event.eventType,
              channel: "email",
              status: result.ok ? "sent" : "failed",
              recipient: notificationEmail,
              subject: event.headline,
              error: result.error ?? null,
              sent_at: result.ok ? new Date().toISOString() : null,
            })
            .then(() => {});
        }
      )
    );
  }

  // Slack
  if (slackWebhookUrl) {
    const blocks = buildSlackGridAlert({
      headline: event.headline,
      body: event.body,
      severity: event.severity,
      appUrl: event.appUrl,
    });

    logPromises.push(
      sendSlackNotification({
        webhookUrl: slackWebhookUrl,
        text: event.headline,
        blocks,
      }).then(async (result) => {
        await client
          .from("notification_log")
          .insert({
            tenant_id: event.tenantId,
            event_type: event.eventType,
            channel: "slack",
            status: result.ok ? "sent" : "failed",
            error: result.error ?? null,
            sent_at: result.ok ? new Date().toISOString() : null,
          })
          .then(() => {});
      })
    );
  }

  // Teams
  if (teamsWebhookUrl) {
    logPromises.push(
      sendTeamsNotification({
        webhookUrl: teamsWebhookUrl,
        title: event.headline,
        text: event.body,
        themeColor:
          event.severity === "critical"
            ? "EF4444"
            : event.severity === "warning"
            ? "F59E0B"
            : "22D3EE",
        actionUrl: event.appUrl,
      }).then(async (result) => {
        await client
          .from("notification_log")
          .insert({
            tenant_id: event.tenantId,
            event_type: event.eventType,
            channel: "teams",
            status: result.ok ? "sent" : "failed",
            error: result.error ?? null,
            sent_at: result.ok ? new Date().toISOString() : null,
          })
          .then(() => {});
      })
    );
  }

  await Promise.allSettled(logPromises);
}
