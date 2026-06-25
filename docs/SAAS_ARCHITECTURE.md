# GridVision AI SaaS Architecture

**Version**: 1.0  
**Date**: June 25, 2026  
**Status**: MVP Ready

---

## Overview

GridVision AI transforms from an enterprise tool into a multi-tenant SaaS platform with subscription-based billing, usage metering, and customer success metrics.

---

## Architecture Components

### 1. Subscription Management

**Core Entities**:
- `subscriptions` — Tenant subscription state
- `subscription_plans` — Plan definitions (Starter, Professional, Enterprise)
- `billing_events` — Event log (upgrades, cancellations, payment events)
- `invoices` — Billing records
- `usage_records` — Monthly usage tracking

**Subscription States**:
```
trial → active → [past_due] → cancelled
 ↓                             ↑
 └─────────────────────────────┘
```

**Plan Limits** (Per Tier):

| Feature | Starter | Professional | Enterprise |
|---------|---------|--------------|------------|
| Max Users | 5 | 20 | Unlimited |
| Max Assets | 100 | 1,000 | 100,000 |
| Max Scenarios | 50 | 500 | 10,000 |
| Monthly API Requests | 10K | 100K | 10M |
| Custom Branding | ❌ | ✅ | ✅ |
| Custom Domain | ❌ | ❌ | ✅ |
| Advanced Analytics | ❌ | ✅ | ✅ |
| API Access | ❌ | ✅ | ✅ |
| Support Tier | Email | Priority | Dedicated |

### 2. Billing System

**Pricing Model**:

| Plan | Monthly | Annual | Trial |
|------|---------|--------|-------|
| Starter | $99 | $990 | 14 days |
| Professional | $499 | $4,990 | 14 days |
| Enterprise | $2,499 | $24,990 | 30 days |

**Billing Cycle**:
- Monthly: $X/month, auto-renews
- Annual: $X/year, 17% discount, auto-renews
- Trial: Full access, no payment required

**Stripe Integration** (Planned):
- Checkout integration for signup
- Billing portal for customers
- Webhook handlers for events
- Invoice generation

### 3. Usage Metering

**Tracked Metrics** (Monthly):
- `api_requests` — Total API calls
- `scenario_runs` — Scenario model executions
- `asset_records` — Number of assets (substations, transformers)
- `user_seats_used` — Active team members
- `storage_gb` — Data storage usage

**Overage Charges** (Optional):
- API overages: $0.10 per 1000 requests
- Storage overages: $1.00 per GB

---

## Service Layer

### Subscription Service
**File**: `lib/services/subscription.service.ts`

**Core Functions**:
- `getSubscription(tenantId)` — Fetch current subscription
- `createSubscription(tenantId, plan, cycle)` — New subscription
- `upgradeSubscription(subscriptionId, newPlan)` — Plan upgrade
- `cancelSubscription(subscriptionId, immediate)` — Cancel subscription
- `recordUsageEvent(tenantId, eventType)` — Track usage
- `getMonthlyUsage(tenantId, year, month)` — Monthly usage report
- `checkUsageLimits(usage, subscription)` — Check if over limit
- `isTrialActive(subscription)` — Trial status
- `getTrialDaysRemaining(subscription)` — Days left in trial

**Usage Recording** (Automatic):
```typescript
// Called after each action
await recordUsageEvent(client, tenantId, "api_request");
await recordUsageEvent(client, tenantId, "scenario_run");
```

### Customer Metrics Service
**File**: `lib/services/customer-metrics.service.ts`

**Metrics Calculated**:
- **ARR** (Annual Recurring Revenue) — Total annual subscription value
- **MRR** (Monthly Recurring Revenue) — Monthly revenue
- **Customer Count** — Active paying tenants
- **Churn Rate** — % of customers lost monthly
- **Trial Conversion** — % of trials that convert to paid
- **Platform Utilization** — % of available seats/assets used
- **LTV** (Lifetime Value) — Expected customer lifetime value

**Functions**:
- `getCustomerMetrics()` — Overall business metrics
- `getInvestorMetrics()` — Executive KPIs + utilization
- `projectRevenue(currentARR, growthRate, months)` — Revenue forecast
- `identifyChurnRisk()` — Customers at risk of cancellation
- `getRecommendedPlan(tenantId)` — Suggest upgrade/downgrade

### Onboarding Service
**File**: `lib/services/onboarding.service.ts`

**Signup Flow**:
1. Customer enters company name, email, plan, billing cycle
2. Create tenant with company details
3. Create subscription (trial status)
4. Seed default settings (timezone, units, brand)
5. Trigger welcome email
6. Return trial days remaining

**Trial to Paid Conversion**:
1. Customer enters payment info (Stripe)
2. Create Stripe customer + subscription
3. Update subscription status to "active"
4. Set billing period dates
5. Record billing event
6. Send welcome email

---

## API Endpoints

### Customer Billing APIs

```
POST   /api/billing/signup                      — New customer signup
GET    /api/billing/subscriptions              — Get current subscription
PATCH  /api/billing/subscriptions              — Change plan/cancel
GET    /api/billing/usage                      — Monthly usage report
```

### Metrics APIs (Admin Only)

```
GET    /api/metrics/customer-success           — CSM dashboard (ARR, MRR, churn)
GET    /api/metrics/investor                   — Executive dashboard (LTV, growth, forecast)
GET    /api/metrics/churn-risk                 — At-risk customers
```

---

## Data Model

### Subscriptions Table

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  plan_tier TEXT NOT NULL, -- starter | professional | enterprise
  status TEXT NOT NULL,    -- trial | active | past_due | cancelled | paused
  billing_cycle TEXT NOT NULL, -- monthly | annual
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  trial_start_date TIMESTAMP,
  trial_end_date TIMESTAMP,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  cancelled_at TIMESTAMP,
  next_billing_date TIMESTAMP,
  amount_paid_cents INTEGER,
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_tenant_id ON subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### Usage Records Table

```sql
CREATE TABLE usage_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  api_requests INTEGER DEFAULT 0,
  scenario_runs INTEGER DEFAULT 0,
  asset_records INTEGER DEFAULT 0,
  user_seats_used INTEGER DEFAULT 0,
  storage_gb DECIMAL DEFAULT 0,
  overage_charges_cents INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, year, month)
);

CREATE INDEX idx_usage_records_tenant_id ON usage_records(tenant_id);
```

### Billing Events Table

```sql
CREATE TABLE billing_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_billing_events_tenant_id ON billing_events(tenant_id);
CREATE INDEX idx_billing_events_type ON billing_events(event_type);
```

---

## Customer Journey

### Signup → Trial → Paid

```
1. Visitor lands on pricing page
   ↓
2. Click "Start Free Trial"
   ↓
3. Signup form:
   - Company name
   - Contact email
   - Plan selection (Starter/Pro/Enterprise)
   - Billing preference (monthly/annual)
   ↓
4. API: POST /api/billing/signup
   - Create tenant
   - Create subscription (trial status)
   - Seed settings
   - Log audit event
   ↓
5. Redirect to setup page
   - Create admin user (auth flow)
   - Invite team
   - Upload first assets
   ↓
6. Trial active (14-30 days)
   - Tenant sees "Trial ends in X days" banner
   - Usage tracked automatically
   - Can export data
   ↓
7. Day 13: Email reminder to upgrade
   ↓
8. Customer adds payment method
   - Stripe checkout redirect
   - Create Stripe customer
   - Process first payment
   ↓
9. API: PATCH /api/billing/subscriptions
   - Convert trial to active
   - Set billing dates
   - Send payment confirmation
   ↓
10. Ongoing: Monthly/annual renewals
    - Automatic billing on current_period_end
    - Usage tracked for next cycle
    - Alerts for limit violations
```

### Plan Change Flow

```
1. Customer in Professional plan uses 150+ assets
   ↓
2. System detects limit violation
   - Show warning: "Approaching limit"
   ↓
3. Plan recommendation:
   - API: GET /api/billing/subscriptions
   - Suggests Enterprise tier
   - Shows savings vs. overage charges
   ↓
4. Customer clicks "Upgrade"
   ↓
5. Confirmation page:
   - New price: $2,499/month
   - Prorated charge for remainder of month
   - Effective immediately
   ↓
6. API: PATCH /api/billing/subscriptions
   {
     "action": "upgrade",
     "planTier": "enterprise"
   }
   ↓
7. Stripe: Upgrade subscription
   - Calculate proration
   - Update invoice
   - Charge difference
   ↓
8. Send upgrade confirmation email
```

### Cancellation Flow

```
1. Customer in settings: "Cancel subscription"
   ↓
2. Confirmation modal:
   - "Your data will be deleted in 30 days"
   - "You can request export now"
   - Feedback form
   ↓
3. Two options:
   a) Cancel at end of billing period
   b) Cancel immediately (prorated refund)
   ↓
4. API: PATCH /api/billing/subscriptions
   {
     "action": "cancel",
     "immediate": false
   }
   ↓
5. Email confirmation with:
   - Cancellation date
   - Final invoice
   - Data retention policy
   - Re-activation instructions
```

---

## Metrics Dashboard

### Customer Success Dashboard

**Displayed On**: Admin dashboard, sent to CSM team daily

**Metrics**:
- **Total ARR** — Aggregate of all active subscriptions
- **Total MRR** — ARR / 12
- **Active Tenants** — Count of status="active" subscriptions
- **Trial Conversions** — % of trials converted to paid (30-day window)
- **Churn Rate** — % of customers lost this month
- **Revenue by Plan** — Breakdown by Starter/Pro/Enterprise
- **Avg MRR per Tenant** — Total MRR / active tenants

**Alerts**:
- ⚠️ If churn > 5% monthly
- ⚠️ If trial conversion < 40%
- ✅ If MRR growth > 10% monthly

### Investor Dashboard

**Displayed On**: Executive meetings, board reports

**Metrics**:
- **Total ARR** (see above)
- **Weighted Pipeline** — From revenue intelligence module
- **Active Users** — Count of user_tenants.is_active
- **Platform Utilization** — % of seats/assets used vs. plan limits
- **Customer LTV** — ARR / (monthly churn rate / 12)
- **CAC Payback** — Months to recover customer acquisition cost
- **Revenue Growth** — MoM/YoY percentage change
- **At-Risk Customers** — Count where last activity > 30 days

**Visualizations**:
- Revenue trend (12-month)
- Revenue by plan (pie chart)
- Growth forecast (12-month projection)
- Churn risk heatmap (top 10 at-risk)
- User activity heatmap (monthly)

---

## White Label Support

**Tenant Settings** (Customizable):

```json
{
  "companyName": "Acme Energy",
  "logoUrl": "https://cdn.example.com/acme-logo.png",
  "brandColor": "#0066cc",
  "timezone": "America/New_York",
  "defaultUnits": "imperial",
  "notificationEmail": "cto@acme.com",
  "customDomain": "gridvision.acme.com" // Enterprise only
}
```

**What Changes**:
- ✅ Logo in UI header
- ✅ Company name in emails
- ✅ Primary brand color (charts, buttons)
- ✅ Timezone for scheduling
- ✅ Unit system (metric/imperial)
- ✅ Custom domain (Enterprise)

---

## Stripe Integration (Future)

**Webhooks Handled**:
- `customer.subscription.created` → Create subscription record
- `customer.subscription.updated` → Update plan/status
- `customer.subscription.deleted` → Record cancellation
- `invoice.payment_succeeded` → Record payment
- `invoice.payment_failed` → Alert, set past_due status
- `charge.refunded` → Handle refund

**Checkout Flow**:
1. Customer selects plan + billing cycle
2. API calls Stripe: create checkout session
3. Redirect to Stripe-hosted checkout
4. Customer enters payment info
5. Stripe sends webhook: `checkout.session.completed`
6. API creates subscription record
7. Customer redirected to dashboard

---

## Security Considerations

1. **Subscription Isolation**:
   - Customers only see own subscription
   - API enforces `tenant_id` filtering

2. **Payment Security**:
   - Never store full card numbers
   - Use Stripe-hosted checkout (PCI compliance)
   - Webhook signature verification

3. **Usage Limits**:
   - Enforce via middleware before action
   - Log limit violations
   - Send warnings before blocking

4. **Audit Trail**:
   - All subscription changes logged
   - All billing events tracked
   - IP address + user-agent captured

---

## Deployment Checklist

### MVP (Phase 14A)

- ✅ Subscription model defined (3 tiers)
- ✅ Database schema created
- ✅ Subscription service implemented
- ✅ Customer metrics calculated
- ✅ Onboarding flow designed
- ✅ API endpoints created
- ✅ Admin dashboards designed
- ⚠️ Stripe integration stubbed (webhook handlers exist)

### Phase 14B (Post-MVP)

- [ ] Stripe Checkout integration
- [ ] Payment processing
- [ ] Invoice generation (PDF)
- [ ] Billing portal (customer view)
- [ ] Dunning flow (payment failures)
- [ ] Usage tracking middleware

### Phase 14C (Scale)

- [ ] Metered billing (usage-based pricing)
- [ ] Seat-based pricing option
- [ ] Volume discounts
- [ ] Multi-year contracts
- [ ] Reseller program

---

## Assumptions & Notes

1. **Usage Metering**: Tracked via service methods, not real-time streaming
2. **Billing Cycle**: Starts on subscription date, renews annually or monthly
3. **Trial Conversion**: Calculated as trial_end → active conversion within 30 days
4. **Churn**: Defined as status change to "cancelled"
5. **LTV**: Estimated as ARR / (monthly churn / 100 / 12)
6. **No Proration**: Initial MVP charges full month upfront

---

## Revenue Model

**Customer Acquisition Cost (CAC)**: $500 (assumed marketing spend)  
**Payback Period**: < 6 months for Professional tier

**LTV Examples**:
- Starter ($99/mo): $1,188/year, LTV ≈ $3,564 (at 5% churn)
- Professional ($499/mo): $5,988/year, LTV ≈ $17,964
- Enterprise ($2,499/mo): $29,988/year, LTV ≈ $89,964

**Profitability**:
- Break-even: 15 Professional tier customers
- Contribution margin: ~70% (after ops costs)
