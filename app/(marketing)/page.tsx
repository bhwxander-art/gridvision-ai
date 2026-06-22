import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Building2,
  Server,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const capabilities = [
  {
    icon: TrendingUp,
    title: "Capacity Forecasting",
    description:
      "Forecast 1-, 3-, and 5-year load growth scenarios across EV adoption, population growth, and data center expansion.",
  },
  {
    icon: Shield,
    title: "Transformer Risk Scoring",
    description:
      "Identify overload risk, aging infrastructure, and N-1 reliability concerns before failures occur.",
  },
  {
    icon: Building2,
    title: "Interconnection Analysis",
    description:
      "Evaluate large-load requests and data center projects against available grid capacity.",
  },
  {
    icon: Brain,
    title: "AI Planning Copilot",
    description:
      "Generate prioritized infrastructure recommendations and capital investment plans.",
  },
];

const customers = [
  {
    icon: Zap,
    title: "Investor-Owned Utilities",
    examples: "Eversource, National Grid, Avangrid",
  },
  {
    icon: Server,
    title: "Regional Grid Operators",
    examples: "ISO New England, NYISO, PJM",
  },
  {
    icon: TrendingUp,
    title: "Transmission Planning Teams",
    examples: "Reliability planning, capital planning, system expansion",
  },
  {
    icon: Users,
    title: "Large Load Strategy Teams",
    examples: "Data centers, hyperscalers, industrial electrification",
  },
];

const stats = [
  { value: "847", label: "MW Forecasted Growth" },
  { value: "23%", label: "Avg. Load Increase" },
  { value: "4", label: "Substation Nodes" },
  { value: "<2s", label: "Forecast Latency" },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-background" />
        <div className="absolute left-1/2 top-0 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              AI Infrastructure Planning Platform
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              AI-Powered Grid Planning for the Era of{" "}
              <span className="text-gradient">Data Centers and Electrification</span>
            </h1>

            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              Forecast grid constraints, evaluate interconnection risk, and
              prioritize capital investments before reliability is impacted.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="glow-cyan" asChild>
                <Link href="/enterprise">
                  Launch Platform
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard">View Forecast Demo</Link>
              </Button>
            </div>
          </div>

          {/* Stats bar */}
          <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="glass-panel rounded-xl p-4 text-center"
              >
                <div className="font-mono text-2xl font-bold text-primary">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Positioning */}
      <section className="border-t border-border/60 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Built for Modern Utility Planning
            </h2>
            <div className="mt-6 space-y-4 text-muted-foreground">
              <p className="text-base leading-relaxed sm:text-lg">
                Utilities are facing unprecedented load growth from AI data
                centers, electrification, EV adoption, and population growth.
                Traditional planning workflows struggle to identify future grid
                constraints before they impact reliability and interconnection
                timelines.
              </p>
              <p className="text-base leading-relaxed sm:text-lg">
                GridVision AI enables utilities and grid operators to forecast
                constraints, assess infrastructure risk, analyze interconnection
                requests, and prioritize capital investments using AI-powered
                planning tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="border-t border-border/60 bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Planning Intelligence for Modern Utilities
            </h2>
            <p className="mt-4 text-muted-foreground">
              GridVision AI gives utility operators the intelligence they need to
              stay ahead of demand — before capacity shortages become outages.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {capabilities.map((cap) => (
              <Card
                key={cap.title}
                className="border-border/60 bg-card/80 transition-colors hover:border-primary/30"
              >
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <cap.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{cap.title}</CardTitle>
                  <CardDescription>{cap.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Grid change context */}
      <section className="border-t border-border/60 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              The Grid Is Changing Faster Than Traditional Planning Tools
            </h2>
            <div className="mt-6 space-y-4 text-muted-foreground">
              <p className="text-base leading-relaxed sm:text-lg">
                Utilities are facing unprecedented demand growth from AI data
                centers, electrification, EV adoption, and population shifts.
                Traditional planning workflows struggle to identify future
                constraints before they impact reliability.
              </p>
              <p className="text-base leading-relaxed sm:text-lg">
                GridVision AI enables utilities to forecast constraints, assess
                infrastructure risk, analyze interconnection requests, and
                prioritize capital investments using AI-powered planning tools.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Target customers */}
      <section className="border-t border-border/60 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Built for Utilities and Grid Operators
            </h2>
            <p className="mt-4 text-muted-foreground">
              Built for the teams responsible for long-range infrastructure
              planning, interconnection review, and capital prioritization.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2">
            {customers.map((customer) => (
              <Card
                key={customer.title}
                className="border-border/60 bg-card/80 transition-colors hover:border-primary/30"
              >
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <customer.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{customer.title}</CardTitle>
                  <CardDescription>{customer.examples}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <CardContent className="relative flex flex-col items-center px-6 py-16 text-center sm:px-12">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight">
                Ready to Forecast Your Grid&apos;s Future?
              </h2>
              <p className="mt-4 max-w-xl text-muted-foreground">
                Forecast constraints, score infrastructure risk, and generate
                AI planning recommendations across your entire service
                territory — in seconds.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Button size="lg" asChild>
                  <Link href="/enterprise">
                    Launch Platform
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/dashboard">View Forecast Demo</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
