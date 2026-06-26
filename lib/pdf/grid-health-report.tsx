import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import React from "react";

export interface GridHealthReportProps {
  tenantName: string;
  score: number;
  status: "stable" | "elevated" | "critical";
  factors: Array<{ label: string; score: number; weight: number; detail: string }>;
  recommendation: string;
  alerts: Array<{ title: string; severity: string; message: string }>;
  generatedAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  stable:   "#22c55e",
  elevated: "#eab308",
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
  scoreBox: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  scoreNumber: {
    fontSize: 48,
    fontFamily: "Helvetica-Bold",
  },
  scoreLabel: {
    fontSize: 14,
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
  col1: { width: "30%" },
  col2: { width: "15%" },
  col3: { width: "15%" },
  col4: { width: "40%" },
  alertBox: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  alertTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },
  alertMessage: {
    fontSize: 9,
    color: "#555555",
  },
  recommendation: {
    borderWidth: 1,
    borderColor: "#0066cc",
    borderRadius: 4,
    padding: 12,
    backgroundColor: "#f0f7ff",
  },
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

export function GridHealthReport({
  tenantName,
  score,
  status,
  factors,
  recommendation,
  alerts,
  generatedAt,
}: GridHealthReportProps) {
  const scoreColor = STATUS_COLOR[status] ?? "#666666";
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>GridVision AI</Text>
          <Text style={styles.subtitle}>Grid Health Report — {tenantName}</Text>
          <Text style={styles.title}>Grid Health Report</Text>
          <Text style={styles.meta}>Generated: {generatedAt}</Text>
        </View>

        {/* Grid Health Score */}
        <Text style={styles.sectionTitle}>Grid Health Score</Text>
        <View style={styles.scoreBox}>
          <Text style={[styles.scoreNumber, { color: scoreColor }]}>{score}</Text>
          <View>
            <Text style={[styles.scoreLabel, { color: scoreColor }]}>{statusLabel}</Text>
            <Text style={{ fontSize: 9, color: "#888888" }}>Out of 100</Text>
          </View>
        </View>

        {/* Factor Breakdown */}
        <Text style={styles.sectionTitle}>Factor Breakdown</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCellBold, styles.col1]}>Factor</Text>
            <Text style={[styles.tableCellBold, styles.col2]}>Score</Text>
            <Text style={[styles.tableCellBold, styles.col3]}>Weight</Text>
            <Text style={[styles.tableCellBold, styles.col4]}>Detail</Text>
          </View>
          {factors.map((f, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.col1]}>{f.label}</Text>
              <Text style={[styles.tableCell, styles.col2]}>{f.score}</Text>
              <Text style={[styles.tableCell, styles.col3]}>{f.weight}</Text>
              <Text style={[styles.tableCell, styles.col4]}>{f.detail}</Text>
            </View>
          ))}
        </View>

        {/* Active Alerts */}
        {alerts.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Active Alerts</Text>
            {alerts.map((a, i) => (
              <View key={i} style={styles.alertBox}>
                <Text style={styles.alertTitle}>
                  [{a.severity.toUpperCase()}] {a.title}
                </Text>
                <Text style={styles.alertMessage}>{a.message}</Text>
              </View>
            ))}
          </>
        )}

        {/* Recommendation */}
        <Text style={styles.sectionTitle}>Recommendation</Text>
        <View style={styles.recommendation}>
          <Text style={{ fontSize: 10 }}>{recommendation}</Text>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>Confidential — GridVision AI</Text>
      </Page>
    </Document>
  );
}
