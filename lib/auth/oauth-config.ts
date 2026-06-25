import "server-only";

/**
 * OAuth Configuration for Microsoft and Google
 * Replaces implicit auth with proper enterprise authentication
 */

export const OAUTH_CONFIG = {
  microsoft: {
    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET || "",
    tenantId: process.env.MICROSOFT_OAUTH_TENANT_ID || "common",
    redirectUri: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback/microsoft`,
    scopes: [
      "profile",
      "email",
      "openid",
      "https://graph.microsoft.com/User.Read",
    ],
    authorizationEndpoint: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize",
    tokenEndpoint: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
  },
  google: {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
    redirectUri: `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback/google`,
    scopes: ["profile", "email", "openid"],
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userInfoEndpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
};

export interface OAuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
  provider: "microsoft" | "google";
}

/**
 * Verify OAuth is configured for production
 */
export function isOAuthConfigured(): boolean {
  const hasMicrosoft =
    !!OAUTH_CONFIG.microsoft.clientId && !!OAUTH_CONFIG.microsoft.clientSecret;
  const hasGoogle =
    !!OAUTH_CONFIG.google.clientId && !!OAUTH_CONFIG.google.clientSecret;

  return hasMicrosoft || hasGoogle;
}

/**
 * Get available OAuth providers
 */
export function getAvailableProviders(): ("microsoft" | "google")[] {
  const providers: ("microsoft" | "google")[] = [];

  if (OAUTH_CONFIG.microsoft.clientId && OAUTH_CONFIG.microsoft.clientSecret) {
    providers.push("microsoft");
  }

  if (OAUTH_CONFIG.google.clientId && OAUTH_CONFIG.google.clientSecret) {
    providers.push("google");
  }

  return providers;
}
