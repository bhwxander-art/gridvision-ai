# Pricing Validation Framework

**Objective**: Test pricing assumptions with real customers  
**Timeline**: During pilot program (Phase 17B-18)  
**Goal**: Validate that customers will pay our pricing

---

## Current Pricing (Baseline)

### Subscription Tiers

| Tier | Monthly | Annual | Users | Assets | Scenarios |
|------|---------|--------|-------|--------|-----------|
| Starter | $99 | $990 | 5 | 100 | 50 |
| Professional | $499 | $4,990 | 20 | 1,000 | 500 |
| Enterprise | $2,499 | $24,990 | Unlimited | Unlimited | Unlimited |

**Assumptions**:
- Most utilities → Professional tier ($500K ARR = 1,000 customers at $499/mo)
- Starter → Small utilities, consultants
- Enterprise → Large utilities, regional operators

---

## Utility Pricing Validation

### Research Questions
1. **Willingness to Pay**: At what price does a $200M+ CapEx utility say "yes"?
2. **Decision Authority**: Who owns the budget? Does it come from IT, operations, or capital planning?
3. **ROI Requirement**: What multiple of price must the financial benefit be?
4. **Contract Length**: Prefer 1-year or 3-year? Annual or monthly?
5. **Feature Sensitivity**: Which features justify premium pricing?

### Discovery Call Pricing Questions

**When They're Interested**:
> "If we were to move forward, what would pricing look like compared to your other software budgets?"

**Listen for**:
- IT/software budget constraints ("We typically spend $100K-500K annually on tools")
- Comparison to alternatives ("GE charges us $1.5M annually")
- Willingness to pay ("If it saves us $10M, we'd pay 5% of that")

**If They Hesitate on Price**:
> "Walk me through your budget process. Does this come from operations or capital projects?"

**Listen for**:
- Budget source (capital > operations for justification)
- Budget cycles (can they re-allocate vs. wait for new budget?)
- Approval threshold (who approves >$100K spending?)

---

## Utility Pricing Scenarios

### Scenario A: Mid-Size Utility ($200M CapEx, 75 substations)

**Annual Savings (Conservative)**:
- Planning time: $300K
- Capital optimization: $16M
- Risk reduction: $100K
- **Total**: $16.4M

**GridVision Cost at Different Price Points**:
| Price | Annual Cost | Payback | ROI |
|-------|------------|---------|-----|
| $72K (Professional) | $72K | <1 week | 22,700% |
| $150K | $150K | <1 week | 10,900% |
| $300K | $300K | <1 week | 5,400% |
| $500K | $500K | <1 week | 3,200% |
| $1M | $1M | <2 weeks | 1,540% |

**Findings**:
- ROI remains 1,000%+ at $1M/year
- Utility would happily pay 10x current price
- **Pricing power is significant**

### Scenario B: Large Utility ($500M CapEx, 200 substations)

**Annual Savings (Base Case)**:
- Planning time: $1M
- Capital optimization: $40M
- Risk reduction: $300K
- **Total**: $41.3M

**Optimal Price Point**:
- At $500K: Still 8,200% ROI
- At $2M: Still 1,950% ROI
- At $5M: Still 726% ROI

**Recommendation**: Start at $500K for large utilities; can go higher

### Scenario C: Small Utility ($50M CapEx, 30 substations)

**Annual Savings**:
- Planning time: $150K
- Capital optimization: $4M
- Risk reduction: $30K
- **Total**: $4.18M

**Optimal Price Point**:
- At $72K/year: 5,700% ROI
- At $150K/year: 2,687% ROI
- At $250K/year: 1,572% ROI

**Recommendation**: $150-250K for small/mid-size utilities

---

## Pricing Testing Strategy (Phase 17B Pilots)

### Pilot Pricing Approach

**Pilot 1**: Free (establish reference customer)
- Rationale: First customer is worth more than subscription fee
- Value: Case study, testimonial, reference for sales
- Conversion: 50% discount Year 1 if sign annual

**Pilot 2-3**: Discounted (60% off first year)
- Rationale: Volume discount for early adopters
- Price: Professional = $200/mo instead of $499
- Term: Annual commitment ($2,400/year)
- Conversion: Full price Year 2

**Pilot 4-5**: Full Price (validate willingness to pay)
- Rationale: Test if customers will pay standard rates
- Price: $499/mo Professional
- Term: Annual or monthly
- Target: 2 of 3 say yes at full price

### Pricing Feedback Collection

**During Pilot**:
- "If this were production software, what would you expect to pay?"
- "Is $72K/year attractive? What about $150K? $250K?"
- "Would you prefer monthly ($499) or annual ($4,990)?"

**Post-Pilot Survey**:
> "Pricing Question: If GridVision cost X per year, would you:
> - Definitely adopt
> - Probably adopt
> - Unsure
> - Probably not
> - Definitely not
>
> [Test at $72K, $150K, $300K, $500K, $1M]"

---

## Data Center Developer Pricing

### Pricing Model Options

**Option A: Per-Assessment Fee**
- $1,000 per grid assessment
- Utility pays for assessment with your co-investment
- Your ROI: $1K × 50 assessments/year = $50K
- Pros: Usage-based, aligns incentives
- Cons: Unpredictable revenue

**Option B: Per-Developer Fee**
- $1,500/month developer platform subscription
- You have unlimited assessments
- Your ROI: 10 developers × $1,500 = $15K/month
- Pros: Predictable, scales with company growth
- Cons: Requires developer adoption

**Option C: Revenue Share**
- 5-10% of interconnection savings
- Works with utility directly
- Your ROI: Scales with customer success
- Pros: Truly aligned incentives
- Cons: Long sales cycle, complex

**Recommendation**: Start with per-assessment ($1-2K) for pilots; move to subscription if matured

---

## Enterprise Contract Pricing

### Multi-Year Discount Strategy

| Contract Length | Discount | Annual Price |
|-----------------|----------|--------------|
| Monthly (cancel anytime) | 0% | $5,988 |
| 1-Year | 5% | $5,689 |
| 2-Year | 12% | $5,270 |
| 3-Year | 20% | $4,790 |

**Rationale**:
- Incentivize longer commitments (reduce churn risk)
- 3-year contracts at $4,790 = $14,370 over 3 years
- Comparable to spending on one GE Vernova project

### Premium Tier Pricing (Enterprise)

**Base Enterprise**: $2,499/month = $29,988/year  
**Premium Add-ons**:
- Custom integrations: +$20K
- Dedicated success manager: +$10K/year
- Advanced analytics module: +$5K/year
- White-label version: +$30K setup, +$5K/year

**Example Enterprise Deal**:
- Base: $29,988/year
- Integrations: $20K (one-time)
- Success manager: $10K/year
- **Total Year 1**: $59,988
- **Total Year 2+**: $39,988/year

---

## Price Sensitivity Analysis

### What We Know
- Competitors charge $300K-$2M annually
- Our base utility price ($72K) is 75-95% cheaper
- ROI is >1,000% even at premium pricing
- Customers already spending $500K-$2M on alternatives

### Price Elasticity Testing

**Hypothesis 1**: "Lower price = more customers"
- Test: Offer $72K vs. $150K to different segments
- Expected: $72K attracts more SMB utilities
- Actual: Monitor adoption rates

**Hypothesis 2**: "Price anchoring affects perception"
- Test: Quote $500K first, then offer $150K (anchored low)
- Expected: Acceptance higher than starting at $150K
- Actual: Monitor win rates

**Hypothesis 3**: "ROI-based pricing commands premium"
- Test: Quote 5-10% of estimated savings
- Expected: Customers accept premium if ROI validated
- Actual: Monitor deal sizes and approval time

---

## Pricing Validation Metrics (Phase 17B)

Track these during pilots:

| Metric | Target | Rationale |
|--------|--------|-----------|
| % customers willing to pay full price | 50%+ | Validates pricing power |
| Average negotiated discount | <10% | Indicates price acceptance |
| Churn (Month 1-3) | <5% | Indicates satisfaction with price |
| Upgrade rate (Starter→Pro) | 30%+ | Indicates feature/price fit |
| Renewal rate (Year 1→2) | 80%+ | Indicates ROI materialization |

---

## Pricing Adjustment Triggers

**Raise Pricing If**:
- 80%+ of pilots willing to pay full price
- <5% discount negotiation
- 0% churn in first year
- 90%+ renewal rate

**Lower Pricing If**:
- <30% of prospects proceed to pilots at current price
- >20% average discount required
- >10% churn due to price concerns
- Competitor underpricing significantly

**Maintain Pricing If**:
- 50-70% willing to pay full
- 10-15% average discount
- 5-10% churn
- Competitive stability

---

## Annual Pricing Review Process

**Q1 (Jan-Mar)**: Analyze prior year data
- Renewal rates
- Churn causes
- Competitor pricing
- Customer feedback

**Q2 (Apr-Jun)**: Test new pricing with new pilots
- Test tiered pricing
- Test add-on pricing
- Gather willingness-to-pay feedback

**Q3 (Jul-Sep)**: Adjust pricing for new contracts
- Implement findings
- Grandfather existing customers (at old price)
- Communicate clearly

**Q4 (Oct-Dec)**: Forecast impact
- Project MRR impact
- Update financial models
- Plan Year 2 strategy

---

## Customer Reference Program

### Goal
Collect proof that customers would recommend GridVision and achieve ROI

### Timeline
- **Day 15**: Pilot satisfaction survey
- **Day 28**: Final evaluation scorecard
- **Day 30**: Testimonial request (if favorable)
- **Day 45**: Case study draft (if customer agrees)
- **Day 60**: Case study published (if customer approves)

### Testimonial Template

**Short Form** (1 sentence):
> "[Customer CEO]: GridVision cut our planning time by 40% and identified $15M in capital optimization opportunities."

**Medium Form** (2-3 sentences):
> "[Customer CEO]: GridVision cut our planning time by 40%. The first scenario analysis identified $15M in capital optimization opportunities we'd missed. Implementation took only 2 weeks, and our team was productive on day 1. We signed a 3-year contract the week after our pilot ended."

**Long Form** (200 words):
[Complete case study structure]

### Case Study Structure

**Problem** (2-3 paragraphs):
- Company background
- Specific pain point
- Why it mattered (financial impact)

**Solution** (2 paragraphs):
- Why they chose GridVision
- Implementation process
- Team adoption

**Results** (2-3 paragraphs):
- Planning time reduction
- Capital optimization discovered
- Revenue impact (if applicable)
- Team satisfaction

**Testimonial Quote**:
- CEO/CFO/CTO quote (1-2 sentences)
- Include title and company

**Metrics Table**:
- Before/after comparison
- Timeline to value
- ROI calculation

---

## Success Criteria (Phase 17B Pricing Validation)

✅ **Confirmed Willingness to Pay**:
- 50%+ of pilots willing to sign at full price
- Average discount <15%

✅ **Price Anchoring Validated**:
- Customers perceive $72K as good value (vs. $500K+ competitors)
- No major price objections

✅ **Tier Adoption Patterns**:
- 70% Professional tier (vs. 20% Starter, 10% Enterprise)
- This validates pricing model assumptions

✅ **ROI Validated**:
- 80%+ of pilots confirm ≥$1M annual savings
- Payback period <4 weeks

✅ **Reference Customers Secured**:
- 2+ customers willing to do case studies
- 3+ customers willing to provide testimonials

✅ **Churn Prevented**:
- 0% churn due to price (only acceptable reason: company policy, not affordability)
- 80%+ renewal rate at end of Year 1

**If all criteria met**: Pricing model is validated; proceed to scale-up
