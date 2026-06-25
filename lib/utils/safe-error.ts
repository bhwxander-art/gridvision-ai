import { type PostgrestError } from "@supabase/supabase-js";

/**
 * Sanitized error response sent to client.
 * Never includes SQL, schema details, or stack traces.
 */
export interface SafeError {
  error: string;
  code?: string;
}

/**
 * Logs full error server-side and returns sanitized message for client.
 * Call this in API routes before sending error response.
 */
export function handleDatabaseError(
  err: unknown,
  context: string
): SafeError {
  const errorMessage = String(err);

  // Log full error with context server-side
  console.error(`[${context}]`, err);

  // Detect error type and return appropriate sanitized message
  if (err instanceof Error) {
    if (
      errorMessage.includes("permission denied") ||
      errorMessage.includes("violates row level security")
    ) {
      return { error: "Access denied", code: "PERMISSION_DENIED" };
    }

    if (
      errorMessage.includes("unique violation") ||
      errorMessage.includes("duplicate key")
    ) {
      return { error: "Resource already exists", code: "DUPLICATE" };
    }

    if (
      errorMessage.includes("foreign key violation") ||
      errorMessage.includes("violates foreign key constraint")
    ) {
      return { error: "Invalid reference", code: "INVALID_REFERENCE" };
    }

    if (
      errorMessage.includes("not found") ||
      errorMessage.includes("no rows affected")
    ) {
      return { error: "Resource not found", code: "NOT_FOUND" };
    }
  }

  // Check if it's a Supabase PostgrestError
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err
  ) {
    const pgErr = err as PostgrestError;

    // PostgreSQL constraint errors
    if (pgErr.code === "23505") {
      return { error: "Resource already exists", code: "DUPLICATE" };
    }
    if (pgErr.code === "23503") {
      return { error: "Invalid reference", code: "INVALID_REFERENCE" };
    }
    if (pgErr.code === "42P01") {
      return { error: "Internal server error", code: "SCHEMA_ERROR" };
    }

    // Permission errors
    if (pgErr.code === "42501" || errorMessage.includes("permission denied")) {
      return { error: "Access denied", code: "PERMISSION_DENIED" };
    }
  }

  // Generic fallback — never reveal details
  return { error: "Internal server error", code: "INTERNAL_ERROR" };
}

/**
 * Generic error handler for non-database errors.
 * Sanitizes auth, validation, and network errors.
 */
export function handleApiError(err: unknown, context: string): SafeError {
  const errorMessage = String(err);

  console.error(`[${context}]`, err);

  if (err instanceof SyntaxError) {
    // JSON parse errors
    return { error: "Invalid request format", code: "INVALID_JSON" };
  }

  if (err instanceof TypeError) {
    // Network or type errors
    if (errorMessage.includes("fetch")) {
      return { error: "External service unavailable", code: "SERVICE_UNAVAILABLE" };
    }
  }

  if (
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("unauthenticated")
  ) {
    return { error: "Unauthorized", code: "UNAUTHORIZED" };
  }

  if (errorMessage.includes("invalid token")) {
    return { error: "Invalid or expired session", code: "INVALID_SESSION" };
  }

  // Generic fallback
  return { error: "Internal server error", code: "INTERNAL_ERROR" };
}

/**
 * Validation error handler — safe to return validation details to client
 */
export function handleValidationError(
  issues: Record<string, string[]>
): SafeError & { details?: Record<string, string[]> } {
  return {
    error: "Validation failed",
    code: "VALIDATION_ERROR",
    details: issues,
  };
}
