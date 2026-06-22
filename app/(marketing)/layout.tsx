import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ErrorBoundary } from "@/components/error-boundary";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="flex-1">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <Footer />
    </>
  );
}
