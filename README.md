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

## AI Configuration

The AI Copilot (`/copilot`, executive reports, and AI-enriched planning insights) requires:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key used to call Claude for chat, executive reports, and planning insights. |

Without it the app still runs — AI endpoints return a `503` with an actionable message instead of crashing, and AI-enriched sections fall back gracefully.

**1. Get a key** — register at [console.anthropic.com](https://console.anthropic.com) and create an API key.

**2. Local development** — add it to `.env.local` (see `.env.example`):

```bash
ANTHROPIC_API_KEY=your-anthropic-api-key
```

Restart `npm run dev` after adding it.

**3. Vercel** — set it on the project via the dashboard (Project → Settings → Environment Variables) or the CLI:

```bash
vercel env add ANTHROPIC_API_KEY production
```

Redeploy after adding it.

**4. Verify** — `GET /api/system/health` reports AI configuration status under `checks.ai`:

```json
"ai": { "status": "up", "error": null }
```

`status: "down"` means the key is missing; `error` names the exact setting to fix.

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
