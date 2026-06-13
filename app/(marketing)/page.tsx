import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Brain,
  Map,
  Shield,
  TrendingUp,
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

const features = [
  {
    icon: Brain,
    title: "AI-Powered Forecasting",
    description:
      "Predict load growth from EV adoption, population shifts, and hyperscale data center buildout with precision models.",
  },
  {
    icon: TrendingUp,
    title: "Growth Scenario Modeling",
    description:
      "Run what-if scenarios across multiple growth vectors to stress-test your grid before bottlenecks emerge.",
  },
  {
    icon: Map,
    title: "Substation Intelligence",
    description:
      "Real-time visibility into substation capacity, risk levels, and geographic load distribution across your service territory.",
  },
  {
    icon: BarChart3,
    title: "Impact Analytics",
    description:
      "Decompose load growth by source — residential EV, fleet charging, AI data centers — with actionable charts.",
  },
  {
    icon: Shield,
    title: "Risk Classification",
    description:
      "Automated LOW / MEDIUM / HIGH risk scoring with capacity recommendations tailored to your infrastructure timeline.",
  },
  {
    icon: Zap,
    title: "Enterprise Ready",
    description:
      "Built for investor demos and utility operations teams. Secure, scalable, and designed for mission-critical planning.",
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
              Next-Gen Utility Intelligence
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Predict Grid Bottlenecks{" "}
              <span className="text-gradient">Before They Happen</span>
            </h1>

            <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
              AI-powered load forecasting for utilities facing rapid growth from
              EVs and data centers.
            </p>

            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="glow-cyan" asChild>
                <Link href="/enterprise">
                  Open Planning Platform
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard">Forecast Demo</Link>
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

      {/* Features */}
      <section className="border-t border-border/60 bg-card/30 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Infrastructure Planning, Reimagined
            </h2>
            <p className="mt-4 text-muted-foreground">
              GridVision AI gives utility operators the intelligence they need to
              stay ahead of demand — before capacity shortages become outages.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <Card
                key={feature.title}
                className="border-border/60 bg-card/80 transition-colors hover:border-primary/30"
              >
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                  <CardDescription>{feature.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Card className="relative overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
            <CardContent className="relative flex flex-col items-center px-6 py-16 text-center sm:px-12">
              <h2 className="text-3xl font-bold tracking-tight">
                Ready to Forecast Your Grid&apos;s Future?
              </h2>
              <p className="mt-4 max-w-xl text-muted-foreground">
                Model EV adoption, population growth, and data center expansion
                in seconds. Get risk scores and capacity recommendations
                instantly.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Button size="lg" asChild>
                  <Link href="/enterprise">
                    Open Planning Platform
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/map">Explore Grid Map</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}
