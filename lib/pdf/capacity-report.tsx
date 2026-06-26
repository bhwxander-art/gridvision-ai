import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import React from "react";

export interface CapacityReportProps {
  tenantName: string;
  currentLoadMW: number;
  capacityMW: number;
  utilizationPct: number;
  headroomMW: number;
  riskLevel: string;
  substations: Array<{
    name: string;
    utilizationPct: number;
    severity: string;
    headroomMW: number;
  }>;
  generatedAt: string;
}

const RISK_COLOR: Record<string, string> = {
  low:      "#22c55e",
  moderate: "#eab308",
  high:     "#f97316",
  critical: "#ef4444",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1a1a1a",
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 48,
    backgroundColor: "#ffffff",
  },
  header: {
    marginBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#0066cc",
    paddingBottom: 12,
  },
  logo: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: "#0066cc",
  },
  subtitle: {
    fontSize: 11,
    color: "#666666",
    marginTop: 2,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
  },
  meta: {
    fontSize: 9,
    color: "#888888",
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: "#0066cc",
    marginBottom: 10,
    marginTop: 20,
    borderLeftWidth: 3,
    borderLeftColor: "#0066cc",
    paddingLeft: 8,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  kpiCard: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 4,
    padding: 12,
    width: "46%",
  },
  kpiLabel: {
    fontSize: 8,
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  kpiValue: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
  },
  table: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 12,
  },
  tableHeader: {
    backgroundColor: "#f5f5f5",
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  tableCell: {
    fontSize: 9,
  },
  tableCellBold: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  col1: { width: "40%" },
  col2: { width: "20%" },
  col3: { width: "20%" },
  col4: { width: "20%" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#aaaaaa",
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
    paddingTop: 8,
  },
});

export function CapacityReport({
  tenantName,
  currentLoadMW,
  capacityMW,
  utilizationPct,
  headroomMW,
  riskLevel,
  substations,
  generatedAt,
}: CapacityReportProps) {
  const riskColor = RISK_COLOR[riskLevel.toLowerCase()] ?? "#666666";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>GridVision AI</Text>
          <Text style={styles.subtitle}>Capacity Report — {tenantName}</Text>
          <Text style={styles.title}>System Capacity Report</Text>
          <Text style={styles.meta}>Generated: {generatedAt}</Text>
        </View>

        {/* KPI Grid */}
        <Text style={styles.sectionTitle}>System Overview</Text>
        <View style={styles.kpiGrid}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Current Load</Text>
            <Text style={styles.kpiValue}>{currentLoadMW.toLocaleString()} MW</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>System Capacity</Text>
            <Text style={styles.kpiValue}>{capacityMW.toLocaleString()} MW</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Utilization</Text>
            <Text style={[styles.kpiValue, { color: riskColor }]}>
              {utilizationPct}%
            </Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Headroom</Text>
            <Text style={styles.kpiValue}>{headroomMW.toLocaleString()} MW</Text>
          </View>
        </View>

        {/* Risk Level */}
        <View
          style={{
            borderWidth: 1,
            borderColor: riskColor,
            borderRadius: 4,
            padding: 10,
            marginBottom: 16,
            backgroundColor: riskColor + "10",
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Helvetica-Bold",
              color: riskColor,
            }}
          >
            Risk Level: {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}
          </Text>
        </View>

        {/* Substation table */}
        {substations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Substation Summary</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCellBold, styles.col1]}>Substation</Text>
                <Text style={[styles.tableCellBold, styles.col2]}>Utilization</Text>
                <Text style={[styles.tableCellBold, styles.col3]}>Severity</Text>
                <Text style={[styles.tableCellBold, styles.col4]}>Headroom</Text>
              </View>
              {substations.map((ss, i) => (
                <View key={i} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.col1]}>{ss.name}</Text>
                  <Text style={[styles.tableCell, styles.col2]}>
                    {ss.utilizationPct.toFixed(1)}%
                  </Text>
                  <Text style={[styles.tableCell, styles.col3]}>{ss.severity}</Text>
                  <Text style={[styles.tableCell, styles.col4]}>
                    {ss.headroomMW.toFixed(0)} MW
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Footer */}
        <Text style={styles.footer}>Confidential — GridVision AI</Text>
      </Page>
    </Document>
  );
}
