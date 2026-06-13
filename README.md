# GridVision AI

AI-powered load forecasting SaaS for utility companies. Predict grid bottlenecks from EV adoption, population growth, and AI data center expansion.

## Tech Stack

- **Next.js 15** — App Router, React Server Components
- **TypeScript** — Full type safety
- **Tailwind CSS** — Utility-first styling with dark mode
- **shadcn/ui** — Accessible component primitives
- **Recharts** — Interactive data visualizations

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page with hero, features, and CTAs |
| `/dashboard` | Interactive forecast dashboard with risk scoring |
| `/analytics` | Load growth, EV impact, and data center charts |
| `/map` | Substation grid map with status monitoring |
| `/about` | Mission, values, and company story |

## Forecast Formula

```
future_load = current_load × (1 + population_growth / 100)
            + current_load × (ev_growth / 200)
            + data_center_load
```

### Risk Levels

| Level | Condition |
|-------|-----------|
| LOW | < 10% increase |
| MEDIUM | 10–25% increase |
| HIGH | > 25% increase |

## Build

```bash
npm run build
npm start
```

## License

Private — GridVision AI
