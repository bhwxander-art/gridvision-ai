import Link from "next/link";
import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-card/50">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/30">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <span className="font-semibold">GridVision AI</span>
            </div>
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              AI-powered load forecasting for utilities facing rapid growth from
              EVs, population expansion, and data center buildout.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Platform</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/dashboard" className="hover:text-foreground">
                  Forecast Dashboard
                </Link>
              </li>
              <li>
                <Link href="/analytics" className="hover:text-foreground">
                  Analytics
                </Link>
              </li>
              <li>
                <Link href="/map" className="hover:text-foreground">
                  Grid Map
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Company</h3>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/about" className="hover:text-foreground">
                  About
                </Link>
              </li>
              <li>
                <span className="cursor-default">Privacy</span>
              </li>
              <li>
                <span className="cursor-default">Terms</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-8 sm:flex-row">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} GridVision AI. All rights reserved.
          </p>
          <p className="text-xs text-muted-foreground">
            Built for utility infrastructure planning
          </p>
        </div>
      </div>
    </footer>
  );
}
