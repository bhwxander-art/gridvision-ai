import "server-only";

/**
 * ROI Report Generator - Creates PDF reports of financial impact
 * Uses serverless PDF generation (text-based template for now)
 */

export interface ROIReportData {
  customerName: string;
  reportDate: string;
  utilityProfile: {
    substations: number;
    annualCapex: number;
    planningTeamSize: number;
    scenariosPerYear: number;
  };
  roiCalculation: {
    planningTimeSavings: number;
    capitalOptimization: number;
    riskReduction: number;
    totalAnnualSavings: number;
    subscriptionCost: number;
    netBenefit: number;
    roi: number;
    paybackMonths: number;
    threeyearNPV: number;
  };
  scenarios: Array<{
    name: string;
    dateConducted: string;
    result: string;
    timeToRun: string;
    capacityUtilization: number;
  }>;
}

/**
 * Generate ROI Report as JSON (can be rendered to PDF on client or via API)
 * Returns structured data ready for PDF rendering
 */
export function generateROIReportData(
  customer: string,
  utilityProfile: any,
  roiCalculation: any,
  scenarios: any[]
): ROIReportData {
  const reportDate = new Date().toISOString().split("T")[0];

  return {
    customerName: customer,
    reportDate,
    utilityProfile: {
      substations: utilityProfile.substationsManaged || 0,
      annualCapex: utilityProfile.annualCapitalSpend || 0,
      planningTeamSize: utilityProfile.planningTeamSize || 0,
      scenariosPerYear: utilityProfile.scenariosPerYear || 0,
    },
    roiCalculation: {
      planningTimeSavings: roiCalculation.planningTimeSavingsUSD || 0,
      capitalOptimization: roiCalculation.capitalSavingsUSD || 0,
      riskReduction: roiCalculation.riskSavingsUSD || 0,
      totalAnnualSavings: roiCalculation.totalAnnualSavings || 0,
      subscriptionCost: roiCalculation.subscriptionCost || 0,
      netBenefit: roiCalculation.netBenefit || 0,
      roi: roiCalculation.roi || 0,
      paybackMonths: roiCalculation.paybackMonths || 0,
      threeyearNPV: roiCalculation.threeyearNPV || 0,
    },
    scenarios: scenarios.map((s) => ({
      name: s.name,
      dateConducted: s.date || new Date().toISOString(),
      result: s.result || "Completed",
      timeToRun: s.timeToRun || "2 hours",
      capacityUtilization: s.utilization || 0,
    })),
  };
}

/**
 * Generate ROI Report as HTML/Markdown for rendering
 */
export function generateROIReportHTML(data: ROIReportData): string {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  };

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GridVision ROI Report - ${data.customerName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #333;
      line-height: 1.6;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #f9f9f9;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      border-bottom: 3px solid #0066cc;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #0066cc;
      margin-bottom: 10px;
    }
    .report-title {
      font-size: 28px;
      font-weight: bold;
      color: #222;
      margin: 20px 0 10px 0;
    }
    .report-date {
      font-size: 14px;
      color: #666;
    }
    .section {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 18px;
      font-weight: bold;
      color: #0066cc;
      border-left: 4px solid #0066cc;
      padding-left: 15px;
      margin-bottom: 20px;
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 20px;
    }
    .metric {
      background: #f5f5f5;
      padding: 20px;
      border-radius: 6px;
    }
    .metric-label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: bold;
      color: #0066cc;
    }
    .metric-unit {
      font-size: 14px;
      color: #999;
    }
    .highlight {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .savings-breakdown {
      border: 1px solid #ddd;
      border-radius: 6px;
      overflow: hidden;
    }
    .savings-row {
      display: flex;
      padding: 15px;
      border-bottom: 1px solid #eee;
    }
    .savings-row:last-child {
      border-bottom: none;
      background: #f9f9f9;
      font-weight: bold;
    }
    .savings-label {
      flex: 1;
    }
    .savings-value {
      text-align: right;
      min-width: 150px;
    }
    .scenario-list {
      list-style: none;
      padding: 0;
    }
    .scenario-item {
      background: #f5f5f5;
      padding: 15px;
      margin-bottom: 10px;
      border-radius: 6px;
      border-left: 3px solid #0066cc;
    }
    .scenario-name {
      font-weight: bold;
      color: #222;
      margin-bottom: 8px;
    }
    .scenario-detail {
      font-size: 13px;
      color: #666;
      margin: 5px 0;
    }
    .footer {
      border-top: 1px solid #eee;
      padding-top: 20px;
      margin-top: 40px;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
    @media print {
      body { background: white; }
      .container { box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">GridVision AI</div>
      <div class="report-title">ROI Analysis Report</div>
      <div class="report-date">Generated: ${data.reportDate}</div>
    </div>

    <div class="section">
      <div class="section-title">Executive Summary</div>
      <div class="highlight">
        <strong>${data.customerName}</strong> can save <strong>${formatCurrency(
    data.roiCalculation.totalAnnualSavings
  )}</strong> annually
        with GridVision AI, with a payback period of just <strong>${data.roiCalculation.paybackMonths.toFixed(
    1
  )} months</strong>.
      </div>
    </div>

    <div class="section">
      <div class="section-title">Utility Profile</div>
      <div class="metric-grid">
        <div class="metric">
          <div class="metric-label">Substations</div>
          <div class="metric-value">${data.utilityProfile.substations}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Annual CapEx</div>
          <div class="metric-value">${formatCurrency(data.utilityProfile.annualCapex)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Planning Team</div>
          <div class="metric-value">${data.utilityProfile.planningTeamSize} <span class="metric-unit">FTE</span></div>
        </div>
        <div class="metric">
          <div class="metric-label">Scenarios/Year</div>
          <div class="metric-value">${data.utilityProfile.scenariosPerYear}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Annual Savings Breakdown</div>
      <div class="savings-breakdown">
        <div class="savings-row">
          <div class="savings-label">Planning Time Savings (40% reduction)</div>
          <div class="savings-value">${formatCurrency(data.roiCalculation.planningTimeSavings)}</div>
        </div>
        <div class="savings-row">
          <div class="savings-label">Capital Optimization (8% efficiency)</div>
          <div class="savings-value">${formatCurrency(data.roiCalculation.capitalOptimization)}</div>
        </div>
        <div class="savings-row">
          <div class="savings-label">Risk Reduction (Outage Prevention)</div>
          <div class="savings-value">${formatCurrency(data.roiCalculation.riskReduction)}</div>
        </div>
        <div class="savings-row">
          <div class="savings-label">Total Annual Savings</div>
          <div class="savings-value">${formatCurrency(data.roiCalculation.totalAnnualSavings)}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Financial Impact</div>
      <div class="metric-grid">
        <div class="metric">
          <div class="metric-label">Annual Subscription Cost</div>
          <div class="metric-value">${formatCurrency(data.roiCalculation.subscriptionCost)}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Net Annual Benefit</div>
          <div class="metric-value" style="color: #28a745;">${formatCurrency(
    data.roiCalculation.netBenefit
  )}</div>
        </div>
        <div class="metric">
          <div class="metric-label">ROI</div>
          <div class="metric-value">${data.roiCalculation.roi.toFixed(0)}%</div>
        </div>
        <div class="metric">
          <div class="metric-label">3-Year NPV</div>
          <div class="metric-value">${formatCurrency(data.roiCalculation.threeyearNPV)}</div>
        </div>
      </div>
    </div>

    ${
      data.scenarios.length > 0
        ? `
    <div class="section">
      <div class="section-title">Pilot Scenarios</div>
      <ul class="scenario-list">
        ${data.scenarios
          .map(
            (s) => `
        <li class="scenario-item">
          <div class="scenario-name">${s.name}</div>
          <div class="scenario-detail">Conducted: ${s.dateConducted}</div>
          <div class="scenario-detail">Time to Run: ${s.timeToRun}</div>
          <div class="scenario-detail">Capacity Utilization: ${s.capacityUtilization.toFixed(1)}%</div>
        </li>
        `
          )
          .join("")}
      </ul>
    </div>
    `
        : ""
    }

    <div class="section">
      <div class="section-title">Next Steps</div>
      <div style="font-size: 14px; line-height: 1.8;">
        <p><strong>1. Validate Numbers</strong> - Review assumptions with your team</p>
        <p><strong>2. Plan Implementation</strong> - 2-3 week deployment timeline</p>
        <p><strong>3. Team Training</strong> - Online training for planning team (2 hours)</p>
        <p><strong>4. Go Live</strong> - Begin using GridVision for all scenarios</p>
      </div>
    </div>

    <div class="footer">
      <p>This report is confidential and for use by ${data.customerName} only.</p>
      <p>GridVision AI | gridvision.ai</p>
    </div>
  </div>
</body>
</html>
`;
}

/**
 * Generate ROI Report as plain text (for email)
 */
export function generateROIReportText(data: ROIReportData): string {
  const formatCurrency = (value: number) => {
    return `$${(value / 1000000).toFixed(2)}M`;
  };

  return `
GridVision AI - ROI Analysis Report
Generated: ${data.reportDate}
Customer: ${data.customerName}

EXECUTIVE SUMMARY
==================
${data.customerName} can save ${formatCurrency(data.roiCalculation.totalAnnualSavings)} annually
with a payback period of just ${data.roiCalculation.paybackMonths.toFixed(1)} months.

UTILITY PROFILE
===============
Substations: ${data.utilityProfile.substations}
Annual CapEx: ${formatCurrency(data.utilityProfile.annualCapex)}
Planning Team: ${data.utilityProfile.planningTeamSize} FTE
Scenarios/Year: ${data.utilityProfile.scenariosPerYear}

ANNUAL SAVINGS BREAKDOWN
========================
Planning Time Savings (40% reduction): ${formatCurrency(data.roiCalculation.planningTimeSavings)}
Capital Optimization (8% efficiency): ${formatCurrency(data.roiCalculation.capitalOptimization)}
Risk Reduction (Outage Prevention): ${formatCurrency(data.roiCalculation.riskReduction)}
────────────────────────────────────────
Total Annual Savings: ${formatCurrency(data.roiCalculation.totalAnnualSavings)}

FINANCIAL IMPACT
================
Annual Subscription Cost: ${formatCurrency(data.roiCalculation.subscriptionCost)}
Net Annual Benefit: ${formatCurrency(data.roiCalculation.netBenefit)}
ROI: ${data.roiCalculation.roi.toFixed(0)}%
3-Year NPV: ${formatCurrency(data.roiCalculation.threeyearNPV)}

PAYBACK ANALYSIS
================
Payback Period: ${data.roiCalculation.paybackMonths.toFixed(1)} months
This means the savings pay for the subscription in under 3 months.

---
Report generated by GridVision AI
gridvision.ai
  `;
}
