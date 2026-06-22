import type { ReactNode } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070b12] text-foreground">
      <header className="border-b border-border/40 bg-[#0a0f18]">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
              <Zap className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-sm font-semibold">GridVision AI</span>
            <span className="text-xs text-muted-foreground">/ Admin</span>
          </Link>
          <Link href="/enterprise" className="text-xs text-muted-foreground hover:text-foreground">
            ← Enterprise
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
