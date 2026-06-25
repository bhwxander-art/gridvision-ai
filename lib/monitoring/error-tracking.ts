import "server-only";

/**
 * Production Error Tracking
 * Sanitizes errors before logging to prevent information leakage
 */

export interface ErrorEvent {
  id: string;
  timestamp: string;
  level: "error" | "warning" | "critical";
  message: string;
  context: Record<string, any>;
  stack?: string;
  userId?: string;
  tenantId?: string;
  endpoint?: string;
}

// Error event store (in production, send to external service)
const errorLog: ErrorEvent[] = [];

/**
 * Track error event
 * Sanitizes sensitive information
 */
export function trackError(
  error: Error | string,
  context: Record<string, any> = {},
  level: "error" | "warning" | "critical" = "error"
): ErrorEvent {
  const message = typeof error === "string" ? error : error.message;
  const stack = typeof error === "object" ? error.stack : undefined;

  const event: ErrorEvent = {
    id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
    level,
    message: sanitizeMessage(message),
    context: sanitizeContext(context),
    stack: stack ? sanitizeStack(stack) : undefined,
    userId: context.userId,
    tenantId: context.tenantId,
    endpoint: context.endpoint,
  };

  errorLog.push(event);

  // Keep last 1000 errors in memory
  if (errorLog.length > 1000) {
    errorLog.shift();
  }

  // In production: send to external error tracking service
  // await sendToExternalTracker(event);

  return event;
}

/**
 * Get recent errors
 */
export function getRecentErrors(limit: number = 100): ErrorEvent[] {
  return errorLog.slice(-limit);
}

/**
 * Sanitize error message
 * Removes database schemas, paths, config details
 */
function sanitizeMessage(message: string): string {
  // Remove database-specific error details
  message = message.replace(/relation ".*" does not exist/gi, "database error");
  message = message.replace(/column ".*" does not exist/gi, "database error");
  message = message.replace(/syntax error in SQL/gi, "database error");

  // Remove file paths
  message = message.replace(/\/[a-z0-9/\-.]+\.(ts|js|sql)/gi, "[file path]");

  // Remove config values
  message = message.replace(/process\.env\.[A-Z_]+/g, "[env var]");

  // Remove URLs
  message = message.replace(/https?:\/\/[^\s]+/g, "[url]");

  return message.substring(0, 500); // Limit length
}

/**
 * Sanitize error context
 * Removes sensitive data
 */
function sanitizeContext(context: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(context)) {
    // Skip sensitive fields
    if (
      key.toLowerCase().includes("password") ||
      key.toLowerCase().includes("token") ||
      key.toLowerCase().includes("secret") ||
      key.toLowerCase().includes("key") ||
      key.toLowerCase().includes("auth")
    ) {
      continue;
    }

    // Limit string length
    if (typeof value === "string") {
      sanitized[key] = value.substring(0, 200);
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = "[object]";
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize stack trace
 * Removes sensitive paths
 */
function sanitizeStack(stack: string): string {
  // Remove absolute paths
  stack = stack.replace(/\/[a-z0-9/\-.]+\//g, "[path]/");

  // Limit stack length
  return stack.substring(0, 1000);
}

/**
 * Critical error alert
 * For high-severity issues
 */
export async function alertCriticalError(event: ErrorEvent): Promise<void> {
  // In production: send alert to ops channel/PagerDuty
  console.error("[CRITICAL ERROR]", {
    id: event.id,
    message: event.message,
    tenant: event.tenantId,
    endpoint: event.endpoint,
  });

  // Example: send to Slack
  // await notifyOps(`CRITICAL: ${event.message}`);
}

/**
 * Get error stats
 */
export function getErrorStats(): {
  total: number;
  byLevel: Record<string, number>;
  byTenant: Record<string, number>;
} {
  const stats = {
    total: errorLog.length,
    byLevel: {} as Record<string, number>,
    byTenant: {} as Record<string, number>,
  };

  for (const event of errorLog) {
    stats.byLevel[event.level] = (stats.byLevel[event.level] || 0) + 1;
    if (event.tenantId) {
      stats.byTenant[event.tenantId] = (stats.byTenant[event.tenantId] || 0) + 1;
    }
  }

  return stats;
}
