import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only print Sentry CLI output in CI
  silent: !process.env.CI,
  // Upload a larger set of source maps for better stack traces in dev mode
  widenClientFileUpload: true,
  webpack: {
    // Tree-shake Sentry logger statements out of the client bundle
    treeshake: { removeDebugLogging: true },
    // No automatic Vercel Cron Monitor wiring
    automaticVercelMonitors: false,
  },
});
