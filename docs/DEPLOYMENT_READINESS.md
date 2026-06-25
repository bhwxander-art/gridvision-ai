# Phase 17A: Customer Validation Sprint - Deployment Readiness

**Date**: June 25, 2026  
**Status**: Production Ready for Pilots  
**Focus**: Customer acquisition and deployment, not feature expansion

---

## Scope: What We Built (Phase 17A)

### ✅ Production Demo Environment
- Demo tenant pre-seeded with realistic data
- Read-only access for 30-minute evaluations
- Hourly data reset for repeatable demos
- No developer assistance required

### ✅ Real Stripe Billing
- Stripe integration (not mocked)
- Checkout sessions for subscriptions
- Webhook handlers for payment events
- Customer portal integration ready
- Proration handling for plan changes

### ✅ OAuth Authentication
- Microsoft Azure AD support
- Google authentication support
- Environment-based configuration
- Fallback to email/password if OAuth unavailable

### ✅ CSV Import Wizard
- Substation asset import (transformers/feeders planned)
- Validation with error handling
- CSV templates for easy data entry
- Batch processing (100+ assets per import)
- Duplicate detection

### ✅ Customer Onboarding Workflow
- 7-step guided setup process
- Progress tracking and checkpoints
- Skip-to-production option
- Audit logging of all steps
- Time estimation per step

### ✅ Automated ROI Reports
- HTML report generation
- Text/plain format for email
- JSON for API consumption
- PDF-ready formatting
- Downloadable as file or embed in email

### ✅ Pilot Environment Setup
- Isolated testing environment for customers
- Production database with RLS policies
- Full feature access (not limited)
- Audit logging enabled
- Performance monitoring ready

---

## Scope: What We Did NOT Build (Explicit Non-Goals)

### ❌ New Dashboards
- No additional analytics dashboards
- No executive summary dashboards
- No AI-powered insights dashboards

### ❌ AI Features
- No machine learning predictions
- No natural language processing
- No anomaly detection

### ❌ Mobile App
- No React Native app
- No iOS/Android support
- No mobile-specific UI

### ❌ Marketplace
- No third-party integrations
- No app store
- No plugin architecture

---

## Implementation Details

### 1. Production Demo Environment

**Access**: `demo.gridvision.ai` (or `localhost:3000/tenant/demo-utility`)

**Features**:
- Pre-loaded: 3 substations, 6 projects, 3 customer accounts
- Read-only for external users
- Hourly reset via cron job
- Demo banner on all pages
- No data persistence (safe for public access)

**Setup Instructions**:
```bash
# Seed demo data during deployment
npm run seed:demo-data

# Configure hourly reset (cron)
0 * * * * npm run reset:demo-data
```

---

### 2. Real Stripe Billing

**Required Environment Variables**:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRODUCT_STARTER=prod_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_STARTER_ANNUAL=price_...
# ... (repeat for professional, enterprise)
```

**Setup Steps**:
1. Create Stripe account at stripe.com
2. Create 3 products (Starter, Professional, Enterprise)
3. Create 6 prices (monthly + annual for each)
4. Add environment variables to production
5. Deploy webhook handlers

**Payment Flow**:
```
Customer → GridVision → Stripe Checkout → Stripe API → Webhook → Database
```

**Webhook Handling**:
- `customer.subscription.created` → Create subscription record
- `customer.subscription.updated` → Update subscription
- `customer.subscription.deleted` → Mark cancelled
- `invoice.payment_succeeded` → Log payment
- `invoice.payment_failed` → Alert, set past_due

---

### 3. OAuth Authentication

**Microsoft Azure AD Setup**:
```
MICROSOFT_OAUTH_CLIENT_ID=...
MICROSOFT_OAUTH_CLIENT_SECRET=...
MICROSOFT_OAUTH_TENANT_ID=common (or specific tenant)
```

**Google Setup**:
```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

**Login Flow**:
```
1. User clicks "Sign in with Google/Microsoft"
2. Redirect to OAuth provider
3. User grants permission
4. Redirect back with auth code
5. Exchange code for token
6. Create/update user in database
7. Create session
8. Redirect to dashboard
```

**Fallback**: If OAuth unavailable, email/password login still works

---

### 4. CSV Import Wizard

**Supported Formats**: Substations (transformers/feeders in roadmap)

**CSV Structure**:
```csv
substation_id,name,region,voltage_kv,nameplate_mva,peak_load_mw,latitude,longitude
SS-001,Downtown Substation,North,345,500,420,40.7128,-74.0060
SS-002,Airport Substation,South,230,350,280,40.6762,-73.9885
```

**API Endpoint**:
```
POST /api/onboarding/import-assets
Content-Type: application/json

{
  "csvContent": "[CSV content]",
  "assetType": "substations",
  "validateOnly": false
}

Response:
{
  "success": true,
  "imported": 100,
  "failed": 2,
  "errors": ["Row 5: Invalid voltage_kv"]
}
```

**Validation**:
- Required fields: substation_id, name, voltage_kv, nameplate_mva
- Numeric validation for kV, MVA, MW
- Duplicate detection by ID
- Preview first 5 rows before import

---

### 5. Customer Onboarding Workflow

**7-Step Process**:

1. **Welcome** (5 min)
   - Product overview
   - Feature highlights
   - Success stories

2. **Company Profile** (5 min)
   - Company name
   - Service territory
   - Utility type
   - Annual CapEx

3. **Asset Import** (15 min)
   - Upload CSV or manual entry
   - Validation + feedback
   - Preview imported assets

4. **First Scenario** (10 min)
   - Select a substation
   - Define scenario (e.g., "200 MW data center request")
   - Run model
   - Review results

5. **ROI Validation** (5 min)
   - Generate ROI report
   - Review financial impact
   - Confirm or adjust assumptions

6. **Team Setup** (10 min, optional)
   - Invite team members
   - Assign roles
   - Send invitations

7. **Training Complete**
   - Ready to go live
   - Can skip to production after step 5

**Progress Tracking**:
- % complete (6 steps = 100%)
- Time remaining estimate
- Ability to skip non-critical steps
- Save progress and resume

---

### 6. Automated ROI Reports

**Report Contents**:
- Executive summary
- Utility profile (substations, CapEx, team size)
- Annual savings breakdown
  - Planning time savings (40% reduction)
  - Capital optimization (8% efficiency)
  - Risk reduction (outage prevention)
- Financial impact
  - Subscription cost
  - Net annual benefit
  - ROI %
  - 3-year NPV
- Pilot scenarios (if completed)
- Next steps

**Formats**:

**HTML**: Full-featured, print-ready
```
POST /api/reports/roi-report
{
  "utilityProfile": {...},
  "roiCalculation": {...},
  "scenarios": [...],
  "format": "html"
}
→ Returns: HTML document with styling, ready for email/download
```

**Text**: Plain text for email body
```
format: "text"
→ Returns: Plain text version, embeddable in email
```

**JSON**: Structured data for API
```
format: "json"
→ Returns: { customerName, reportDate, utilityProfile, roiCalculation, scenarios }
```

---

### 7. Pilot Environment Setup

**Separate from Production**:
- Dev/Staging/Pilot environments
- Same database schema as production
- RLS policies enabled
- Full data isolation

**Customer Pilot Setup**:
1. Create dedicated tenant for pilot
2. Provision Stripe product (free trial or $1 test)
3. Pre-populate with sample assets (optional)
4. Enable audit logging
5. Set pilot end date
6. Configure success criteria tracking

**Pilot Timeline**:
- 30-day evaluation period
- Weekly check-in calls
- Usage metrics dashboard
- Success criteria tracking
- Decision gate at day 28

---

## Deployment Checklist

### Pre-Deployment (1 week before)

- [ ] Stripe account created and verified
- [ ] OAuth apps created (Microsoft + Google)
- [ ] Environment variables configured
- [ ] Database migrations run (seed demo data)
- [ ] SSL certificates configured
- [ ] Monitoring/alerts set up
- [ ] Backup procedures tested
- [ ] Customer support email configured

### Deployment Day

- [ ] Pull latest code
- [ ] Run database migrations
- [ ] Seed demo data
- [ ] Deploy to production
- [ ] Run smoke tests
- [ ] Verify OAuth login
- [ ] Test Stripe webhook
- [ ] Confirm demo access
- [ ] Test CSV import

### Post-Deployment (Day 1-3)

- [ ] Monitor error rates
- [ ] Check database performance
- [ ] Verify backup completion
- [ ] Test customer signup flow
- [ ] Confirm email notifications
- [ ] Review audit logs
- [ ] Check payment processing

---

## Customer Success Metrics (Phase 17A Target)

### 30-Day Goals

| Metric | Target | Why |
|--------|--------|-----|
| Live demos completed | 5 | Validation of product appeal |
| Pilot customers activated | 3 | Early adopter engagement |
| Paying customers | 1 | Product-market fit signal |
| Annual contracts signed | 1 | Revenue recognition |
| CSV imports completed | 5+ | Asset data validation |
| Onboarding completions | 3+ | Workflow effectiveness |
| ROI reports generated | 5+ | Customer value recognition |

### 90-Day Goals

| Metric | Target |
|--------|--------|
| Paying customers | 3+ |
| ARR (Annual Recurring Revenue) | $300K+ |
| Pilots active | 2+ (in parallel) |
| Case studies generated | 1+ |
| NPS (Net Promoter Score) | 50+ |

---

## Troubleshooting

### "CSV Import Fails with Encoding Error"
- Ensure CSV is UTF-8 encoded
- Use Microsoft Excel "Save As → CSV UTF-8" option
- Check for non-ASCII characters

### "Stripe Webhook Not Received"
- Verify webhook URL is accessible from internet
- Check webhook secret matches environment variable
- Review Stripe webhook logs: https://dashboard.stripe.com/webhooks
- Test webhook delivery

### "OAuth Login Redirects to Login Loop"
- Verify redirect URI matches exactly in OAuth provider settings
- Check NEXTAUTH_URL environment variable
- Ensure tokens are being generated
- Review browser console for auth errors

### "Demo Data Not Showing"
- Run `npm run seed:demo-data` manually
- Verify tenant ID matches demo-utility
- Check RLS policies aren't blocking read access
- Confirm cache isn't stale

---

## Production Readiness Validation

**Before launching to first customer**:

### Security Checklist
- [ ] SSL/TLS enabled (HTTPS only)
- [ ] Secrets not in version control
- [ ] RLS policies verified
- [ ] SQL injection protection tested
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] DDoS protection enabled

### Performance Checklist
- [ ] Database queries optimized (<100ms)
- [ ] API response times <500ms
- [ ] Static assets cached
- [ ] CDN configured (if applicable)
- [ ] Load testing completed
- [ ] Horizontal scaling verified

### Reliability Checklist
- [ ] Uptime monitoring configured
- [ ] Error tracking (Sentry/similar) enabled
- [ ] Database backups automated
- [ ] Disaster recovery plan documented
- [ ] On-call rotation established
- [ ] Runbooks written

---

## Success: Ready for Phase 18 (Scaling)

Once Phase 17A is complete and first customer is live:

✅ **Product is production-ready**
✅ **Billing is working**
✅ **Authentication is secure**
✅ **Onboarding is smooth**
✅ **Customers can self-serve**
✅ **ROI is documented**

**Next**: Phase 18 focuses on scaling (more customers, marketing, support).
