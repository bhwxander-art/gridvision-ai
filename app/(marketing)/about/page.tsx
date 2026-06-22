import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Globe,
  Shield,
  Target,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "About",
};

const values = [
  {
    icon: Target,
    title: "Proactive Planning",
    description:
      "We believe utilities should identify capacity constraints years before they become service disruptions — not after the fact.",
  },
  {
    icon: Shield,
    title: "Grid Reliability",
    description:
      "Every forecast, risk score, and recommendation is designed to protect grid reliability and public safety.",
  },
  {
    icon: Globe,
    title: "Climate-Aligned Growth",
    description:
      "EV adoption and clean energy transition require smarter infrastructure planning. We help utilities lead that transition.",
  },
  {
    icon: Users,
    title: "Operator-First Design",
    description:
      "Built with input from transmission planners, distribution engineers, and utility executives who live this problem daily.",
  },
];

const timeline = [
  {
    year: "2024",
    event: "Founded with a mission to modernize utility load forecasting",
  },
  {
    year: "2025",
    event: "Launched AI forecasting engine with EV and data center modeling",
  },
  {
    year: "2026",
    event: "Expanded to interconnection analysis, transformer risk scoring, and AI Planning Copilot",
  },
];

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-20" />
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              Our Mission
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Planning Infrastructure Before{" "}
              <span className="text-gradient">Shortages Occur</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              GridVision AI is an AI-powered infrastructure planning platform
              designed to help electric utilities anticipate grid constraints,
              improve reliability planning, and make smarter capital investment
              decisions.
            </p>
          </div>
        </div>
      </section>

      {/* Mission statement */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">
                The Problem We Solve
              </h2>
              <div className="mt-6 space-y-4 text-muted-foreground">
                <p>
                  America&apos;s electrical grid was built for a different era.
                  Today, utilities face unprecedented demand growth from
                  electric vehicles, population expansion in key metros, and the
                  explosive rise of AI data centers consuming hundreds of
                  megawatts per facility.
                </p>
                <p>
                  Traditional load forecasting methods weren&apos;t designed for
                  this velocity of change. Utilities need AI-powered intelligence
                  that models multiple growth vectors simultaneously and surfaces
                  capacity risks before they become outages.
                </p>
                <p>
                  GridVision AI delivers that intelligence — turning complex
                  growth scenarios into constraint forecasts, infrastructure
                  risk scores, and prioritized capital investment recommendations.
                </p>
              </div>
            </div>

            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-card">
              <CardHeader>
                <CardTitle>By the Numbers</CardTitle>
                <CardDescription>
                  The scale of the challenge utilities face
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-6">
                {[
                  { value: "40%", label: "Projected load growth by 2030" },
                  { value: "336 MW", label: "Avg. hyperscale data center" },
                  { value: "26M", label: "EVs on US roads by 2030" },
                  { value: "$2.5T", label: "Grid investment needed" },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className="font-mono text-2xl font-bold text-primary">
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="border-t border-border/60 bg-card/30 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Our Values</h2>
            <p className="mt-4 text-muted-foreground">
              The principles that guide everything we build
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {values.map((value) => (
              <Card key={value.title} className="border-border/60 bg-card/80">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <value.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-lg">{value.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">
                    {value.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Timeline */}
      <section className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight">
            Our Journey
          </h2>
          <div className="mx-auto mt-12 max-w-2xl">
            {timeline.map((item, i) => (
              <div key={item.year} className="flex gap-6">
                <div className="flex flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
                    <span className="font-mono text-xs font-bold text-primary">
                      {item.year.slice(2)}
                    </span>
                  </div>
                  {i < timeline.length - 1 && (
                    <div className="w-px flex-1 bg-border" />
                  )}
                </div>
                <div className="pb-10">
                  <p className="font-mono text-sm text-primary">{item.year}</p>
                  <p className="mt-1 text-muted-foreground">{item.event}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 py-20">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight">
            See GridVision AI in Action
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Run your first load forecast in under a minute. No account required
            for the demo.
          </p>
          <Button size="lg" className="mt-8" asChild>
            <Link href="/dashboard">
              Launch Dashboard
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
