import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ErrorBoundary } from "@/components/error-boundary";

export const metadata: Metadata = {
  title: "Enterprise",
};

export default function Layout({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
