/**
 * INFRA-008: IEC 61970 CIM XML Parser — test suite
 *
 * All tests use synthetic CIM XML generated inline (no external files).
 * Integration tests that would need the real PEGASE 1354-bus file are
 * guarded with skipIf(!INTEGRATION).
 *
 * Test categories:
 *  1. Version detection
 *  2. CIM 14 (ConnectivityNode-based) parsing
 *  3. CIM 17 (TopologicalNode-based) parsing
 *  4. Transformer tap ratio computation
 *  5. Cross-version equivalence (CIM 14 ↔ CIM 17)
 *  6. Edge cases and warning generation
 *  7. Performance — 500-bus synthetic network
 */

import { describe, it, expect } from "vitest";
import {
  detectCimVersion,
  parseCimXml,
  type CimBranch,
} from "@/lib/parsers/cim/cim-parser";

const INTEGRATION = !!process.env.INTEGRATION;

// ── XML generation helpers ────────────────────────────────────────────────────

const RDF_NS = `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"`;
const CIM14_NS = `xmlns:cim="http://iec.ch/TC57/2003/CIM-schema-cim14#"`;
const CIM16_NS = `xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"`;
const CIM17_NS = `xmlns:cim="http://iec.ch/TC57/CIM100#"`;

function rdfOpen(nsDecl: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF ${RDF_NS}\n         ${nsDecl}>\n`;
}
const rdfClose = `</rdf:RDF>`;

function baseVoltage(id: string, kv: number) {
  return `
  <cim:BaseVoltage rdf:ID="${id}">
    <cim:IdentifiedObject.name>${kv}kV</cim:IdentifiedObject.name>
    <cim:BaseVoltage.nominalVoltage>${kv}</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>`;
}

function voltageLevel(id: string, bvId: string) {
  return `
  <cim:VoltageLevel rdf:ID="${id}">
    <cim:VoltageLevel.BaseVoltage rdf:resource="#${bvId}"/>
  </cim:VoltageLevel>`;
}

// CIM 14: buses are ConnectivityNodes inside a VoltageLevel
function connectivityNode(id: string, name: string, vlId: string) {
  return `
  <cim:ConnectivityNode rdf:ID="${id}">
    <cim:IdentifiedObject.name>${name}</cim:IdentifiedObject.name>
    <cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#${vlId}"/>
  </cim:ConnectivityNode>`;
}

// CIM 16/17: buses are TopologicalNodes with direct BaseVoltage reference
function topologicalNode(id: string, name: string, bvId: string) {
  return `
  <cim:TopologicalNode rdf:ID="${id}">
    <cim:IdentifiedObject.name>${name}</cim:IdentifiedObject.name>
    <cim:TopologicalNode.BaseVoltage rdf:resource="#${bvId}"/>
  </cim:TopologicalNode>`;
}

function terminal(
  id: string,
  equipId: string,
  seq: number,
  opts: { cn?: string; tn?: string }
) {
  const cnRef = opts.cn ? `\n    <cim:Terminal.ConnectivityNode rdf:resource="#${opts.cn}"/>` : "";
  const tnRef = opts.tn ? `\n    <cim:Terminal.TopologicalNode rdf:resource="#${opts.tn}"/>` : "";
  return `
  <cim:Terminal rdf:ID="${id}">
    <cim:Terminal.ConductingEquipment rdf:resource="#${equipId}"/>${cnRef}${tnRef}
    <cim:ACDCTerminal.sequenceNumber>${seq}</cim:ACDCTerminal.sequenceNumber>
  </cim:Terminal>`;
}

function acLine(id: string, name: string, r: number, x: number, bch: number) {
  return `
  <cim:ACLineSegment rdf:ID="${id}">
    <cim:IdentifiedObject.name>${name}</cim:IdentifiedObject.name>
    <cim:ACLineSegment.r>${r}</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>${x}</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>${bch}</cim:ACLineSegment.bch>
  </cim:ACLineSegment>`;
}

function powerTransformer(id: string, name: string) {
  return `
  <cim:PowerTransformer rdf:ID="${id}">
    <cim:IdentifiedObject.name>${name}</cim:IdentifiedObject.name>
  </cim:PowerTransformer>`;
}

function transformerEnd(
  id: string,
  ptId: string,
  endNum: number,
  termId: string,
  opts: { r?: number; x?: number; b?: number; ratedU?: number }
) {
  return `
  <cim:PowerTransformerEnd rdf:ID="${id}">
    <cim:PowerTransformerEnd.PowerTransformer rdf:resource="#${ptId}"/>
    <cim:TransformerEnd.endNumber>${endNum}</cim:TransformerEnd.endNumber>
    <cim:TransformerEnd.Terminal rdf:resource="#${termId}"/>
    <cim:PowerTransformerEnd.r>${opts.r ?? 0}</cim:PowerTransformerEnd.r>
    <cim:PowerTransformerEnd.x>${opts.x ?? 0.1}</cim:PowerTransformerEnd.x>
    <cim:PowerTransformerEnd.b>${opts.b ?? 0}</cim:PowerTransformerEnd.b>
    <cim:PowerTransformerEnd.ratedU>${opts.ratedU ?? 138}</cim:PowerTransformerEnd.ratedU>
  </cim:PowerTransformerEnd>`;
}

function topologicalIsland(id: string, angleRefTnId: string) {
  return `
  <cim:TopologicalIsland rdf:ID="${id}">
    <cim:IdentifiedObject.name>Island_1</cim:IdentifiedObject.name>
    <cim:TopologicalIsland.AngleRefTopologicalNode rdf:resource="#${angleRefTnId}"/>
  </cim:TopologicalIsland>`;
}

function synchronousMachine(id: string, name: string, termId: string, ratedS?: number) {
  const ratedSEl = ratedS != null
    ? `\n    <cim:SynchronousMachine.ratedS>${ratedS}</cim:SynchronousMachine.ratedS>`
    : "";
  return `
  <cim:SynchronousMachine rdf:ID="${id}">
    <cim:IdentifiedObject.name>${name}</cim:IdentifiedObject.name>${ratedSEl}
    <cim:Terminal rdf:resource="#${termId}"/>
  </cim:SynchronousMachine>`;
}

function unknownElement(id: string) {
  return `
  <cim:WeirdFutureElement rdf:ID="${id}">
    <cim:IdentifiedObject.name>Future Device</cim:IdentifiedObject.name>
  </cim:WeirdFutureElement>`;
}

// ── Canonical 3-bus triangle network (CIM 14) ─────────────────────────────────
//
//  Bus_1 ──L12── Bus_2
//    \               /
//   L13            L23
//    \             /
//        Bus_3
//
// All buses at 138 kV.

function makeCim14Network(): string {
  const body =
    baseVoltage("BV_138", 138) +
    voltageLevel("VL_1", "BV_138") +
    connectivityNode("CN_1", "Bus_1", "VL_1") +
    connectivityNode("CN_2", "Bus_2", "VL_1") +
    connectivityNode("CN_3", "Bus_3", "VL_1") +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { cn: "CN_1" }) +
    terminal("T_L12_2", "L12", 2, { cn: "CN_2" }) +
    acLine("L13", "Line_1_3", 0.05403, 0.22304, 0.0492) +
    terminal("T_L13_1", "L13", 1, { cn: "CN_1" }) +
    terminal("T_L13_2", "L13", 2, { cn: "CN_3" }) +
    acLine("L23", "Line_2_3", 0.03699, 0.17103, 0.0346) +
    terminal("T_L23_1", "L23", 1, { cn: "CN_2" }) +
    terminal("T_L23_2", "L23", 2, { cn: "CN_3" });

  return rdfOpen(CIM14_NS) + body + "\n" + rdfClose;
}

// ── Identical 3-bus triangle network (CIM 17) ────────────────────────────────

function makeCim17Network(): string {
  const body =
    baseVoltage("BV_138", 138) +
    topologicalNode("TN_1", "Bus_1", "BV_138") +
    topologicalNode("TN_2", "Bus_2", "BV_138") +
    topologicalNode("TN_3", "Bus_3", "BV_138") +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { tn: "TN_1" }) +
    terminal("T_L12_2", "L12", 2, { tn: "TN_2" }) +
    acLine("L13", "Line_1_3", 0.05403, 0.22304, 0.0492) +
    terminal("T_L13_1", "L13", 1, { tn: "TN_1" }) +
    terminal("T_L13_2", "L13", 2, { tn: "TN_3" }) +
    acLine("L23", "Line_2_3", 0.03699, 0.17103, 0.0346) +
    terminal("T_L23_1", "L23", 1, { tn: "TN_2" }) +
    terminal("T_L23_2", "L23", 2, { tn: "TN_3" });

  return rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
}

// ── CIM 17 network with SLACK bus marked in TopologicalIsland ─────────────────

function makeCim17NetworkWithSlack(slackTnId: string): string {
  const body =
    baseVoltage("BV_138", 138) +
    topologicalNode("TN_1", "Bus_1", "BV_138") +
    topologicalNode("TN_2", "Bus_2", "BV_138") +
    topologicalNode("TN_3", "Bus_3", "BV_138") +
    topologicalIsland("TI_1", slackTnId) +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { tn: "TN_1" }) +
    terminal("T_L12_2", "L12", 2, { tn: "TN_2" }) +
    acLine("L23", "Line_2_3", 0.03699, 0.17103, 0.0346) +
    terminal("T_L23_1", "L23", 1, { tn: "TN_2" }) +
    terminal("T_L23_2", "L23", 2, { tn: "TN_3" });

  return rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
}

// ── CIM 17 network with a SynchronousMachine (PV bus) ────────────────────────

function makeCim17NetworkWithGenerator(pvTnId: string): string {
  const body =
    baseVoltage("BV_138", 138) +
    topologicalNode("TN_1", "Bus_1", "BV_138") +
    topologicalNode("TN_2", "Bus_2", "BV_138") +
    topologicalNode("TN_3", "Bus_3", "BV_138") +
    // Generator connected to pvTnId via terminal G_T1
    `
  <cim:Terminal rdf:ID="G_T1">
    <cim:Terminal.ConductingEquipment rdf:resource="#GEN_1"/>
    <cim:Terminal.TopologicalNode rdf:resource="#${pvTnId}"/>
    <cim:ACDCTerminal.sequenceNumber>1</cim:ACDCTerminal.sequenceNumber>
  </cim:Terminal>` +
    synchronousMachine("GEN_1", "Generator_1", "G_T1", 200) +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { tn: "TN_1" }) +
    terminal("T_L12_2", "L12", 2, { tn: "TN_2" }) +
    acLine("L23", "Line_2_3", 0.03699, 0.17103, 0.0346) +
    terminal("T_L23_1", "L23", 1, { tn: "TN_2" }) +
    terminal("T_L23_2", "L23", 2, { tn: "TN_3" });

  return rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
}

// ── 2-bus network with a transformer ─────────────────────────────────────────

function makeNetworkWithTransformer(
  baseKvFrom: number,
  baseKvTo: number,
  ratedUFrom: number,
  ratedUTo: number
): string {
  const body =
    baseVoltage("BV_H", baseKvFrom) +
    baseVoltage("BV_L", baseKvTo) +
    topologicalNode("TN_H", `Bus_H_${baseKvFrom}kV`, "BV_H") +
    topologicalNode("TN_L", `Bus_L_${baseKvTo}kV`, "BV_L") +
    powerTransformer("TR_1", "Transformer_1") +
    transformerEnd("TR_1_W1", "TR_1", 1, "T_TR_H", { r: 0.001, x: 0.05, b: 0, ratedU: ratedUFrom }) +
    transformerEnd("TR_1_W2", "TR_1", 2, "T_TR_L", { r: 0.001, x: 0.05, b: 0, ratedU: ratedUTo }) +
    terminal("T_TR_H", "TR_1_W1", 1, { tn: "TN_H" }) +
    terminal("T_TR_L", "TR_1_W2", 2, { tn: "TN_L" });

  return rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
}

// ── CIM 14 with unknown element type ────────────────────────────────────────

function makeCim14NetworkWithUnknown(): string {
  const body =
    baseVoltage("BV_138", 138) +
    voltageLevel("VL_1", "BV_138") +
    connectivityNode("CN_1", "Bus_1", "VL_1") +
    connectivityNode("CN_2", "Bus_2", "VL_1") +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { cn: "CN_1" }) +
    terminal("T_L12_2", "L12", 2, { cn: "CN_2" }) +
    unknownElement("UNK_1");

  return rdfOpen(CIM14_NS) + body + "\n" + rdfClose;
}

// ── CIM 14 where a bus references a non-existent VoltageLevel ────────────────

function makeCim14NetworkMissingVoltage(): string {
  const body =
    baseVoltage("BV_138", 138) +
    voltageLevel("VL_1", "BV_138") +
    connectivityNode("CN_1", "Bus_1", "VL_1") +
    // CN_2 references a VoltageLevel that doesn't exist → no base voltage
    `
  <cim:ConnectivityNode rdf:ID="CN_2">
    <cim:IdentifiedObject.name>Bus_2</cim:IdentifiedObject.name>
    <cim:ConnectivityNode.ConnectivityNodeContainer rdf:resource="#VL_MISSING"/>
  </cim:ConnectivityNode>` +
    acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
    terminal("T_L12_1", "L12", 1, { cn: "CN_1" }) +
    terminal("T_L12_2", "L12", 2, { cn: "CN_2" });

  return rdfOpen(CIM14_NS) + body + "\n" + rdfClose;
}

// ── Large synthetic CIM 16 network (ring topology) ───────────────────────────

function makeLargeSyntheticNetwork(busCount: number, branchCount: number): string {
  const parts: string[] = [rdfOpen(CIM16_NS)];

  parts.push(baseVoltage("BV_138", 138));

  for (let i = 1; i <= busCount; i++) {
    parts.push(topologicalNode(`TN_${i}`, `Bus_${i}`, "BV_138"));
  }

  // Build exactly branchCount branches starting with a ring
  let branchNum = 0;
  for (let i = 1; i <= busCount && branchNum < branchCount; i++) {
    const j = (i % busCount) + 1; // ring: i→i+1, last→1
    const lid = `L_${i}_${j}`;
    parts.push(acLine(lid, `Line_${i}_${j}`, 0.001 + i * 0.0001, 0.01 + i * 0.0001, 0.001));
    parts.push(terminal(`T_${lid}_1`, lid, 1, { tn: `TN_${i}` }));
    parts.push(terminal(`T_${lid}_2`, lid, 2, { tn: `TN_${j}` }));
    branchNum++;
  }

  // Extra cross-connections
  for (let k = 0; branchNum < branchCount; k++) {
    const i = (k * 7 + 1) % busCount + 1;
    const j = (k * 13 + 3) % busCount + 1;
    if (i === j) continue;
    const lid = `XL_${i}_${j}_${k}`;
    parts.push(acLine(lid, `CrossLine_${k}`, 0.002, 0.02, 0.002));
    parts.push(terminal(`T_${lid}_1`, lid, 1, { tn: `TN_${i}` }));
    parts.push(terminal(`T_${lid}_2`, lid, 2, { tn: `TN_${j}` }));
    branchNum++;
  }

  parts.push(rdfClose);
  return parts.join("\n");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("detectCimVersion", () => {
  it("detects CIM 14 namespace", () => {
    expect(detectCimVersion('xmlns:cim="http://iec.ch/TC57/2003/CIM-schema-cim14#"')).toBe("14");
  });

  it("detects CIM 16 from 2011 URI variant", () => {
    expect(detectCimVersion('xmlns:cim="http://iec.ch/TC57/2011/CIM-schema-cim16#"')).toBe("16");
  });

  it("detects CIM 16 from 2013 URI variant", () => {
    expect(detectCimVersion('xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#"')).toBe("16");
  });

  it("detects CIM 17 from CIM100 URI", () => {
    expect(detectCimVersion('xmlns:cim="http://iec.ch/TC57/CIM100#"')).toBe("17");
  });

  it("defaults to CIM 16 for unrecognized namespace", () => {
    expect(detectCimVersion('xmlns:cim="http://example.org/unknown-schema#"')).toBe("16");
  });
});

// ── CIM 14 (ConnectivityNode-based) ──────────────────────────────────────────

describe("parseCimXml — CIM 14 ConnectivityNode topology", () => {
  it("reports version = '14'", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.version).toBe("14");
  });

  it("parses exactly 3 buses", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.buses).toHaveLength(3);
  });

  it("parses exactly 3 branches", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.branches).toHaveLength(3);
  });

  it("assigns sequential bus numbers starting at 1", () => {
    const result = parseCimXml(makeCim14Network());
    const nums = result.buses.map(b => b.busNumber).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3]);
  });

  it("preserves bus names", () => {
    const result = parseCimXml(makeCim14Network());
    const names = result.buses.map(b => b.name).sort();
    expect(names).toContain("Bus_1");
    expect(names).toContain("Bus_2");
    expect(names).toContain("Bus_3");
  });

  it("resolves base voltage via VoltageLevel container", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.buses.every(b => b.baseKv === 138)).toBe(true);
  });

  it("all buses default to PQ type", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.buses.every(b => b.busType === "PQ")).toBe(true);
  });

  it("stores branch r/x/b parameters correctly for Line_1_2", () => {
    const result = parseCimXml(makeCim14Network());
    const br = result.branches.find(b => b.name === "Line_1_2");
    expect(br).toBeDefined();
    expect(Math.abs(br!.rPu - 0.01938)).toBeLessThan(1e-9);
    expect(Math.abs(br!.xPu - 0.05917)).toBeLessThan(1e-9);
    expect(Math.abs(br!.bPu - 0.0528)).toBeLessThan(1e-9);
  });

  it("sets tapRatio=1.0 and phaseShiftDeg=0 for all lines", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.branches.every(b => b.tapRatio === 1.0)).toBe(true);
    expect(result.branches.every(b => b.phaseShiftDeg === 0.0)).toBe(true);
  });

  it("all branches have branchType = LINE", () => {
    const result = parseCimXml(makeCim14Network());
    expect(result.branches.every(b => b.branchType === "LINE")).toBe(true);
  });

  it("emits warning for unrecognized CIM element types", () => {
    const result = parseCimXml(makeCim14NetworkWithUnknown());
    expect(result.warnings.some(w => w.includes("Unrecognized"))).toBe(true);
    expect(result.warnings.some(w => w.includes("WeirdFutureElement"))).toBe(true);
  });

  it("does not fail when unrecognized elements are present", () => {
    const result = parseCimXml(makeCim14NetworkWithUnknown());
    expect(result.buses).toHaveLength(2);
    expect(result.branches).toHaveLength(1);
  });

  it("skips bus with no resolvable base voltage and emits warning", () => {
    const result = parseCimXml(makeCim14NetworkMissingVoltage());
    expect(result.warnings.some(w => w.includes("base voltage"))).toBe(true);
    // CN_2 is skipped → only CN_1 becomes a bus
    expect(result.buses).toHaveLength(1);
    // L12 cannot resolve both terminals → skipped
    expect(result.branches).toHaveLength(0);
  });

  it("emits warning for branch with unresolvable bus connection", () => {
    const result = parseCimXml(makeCim14NetworkMissingVoltage());
    expect(result.warnings.some(w => w.includes("cannot resolve bus"))).toBe(true);
  });
});

// ── CIM 17 (TopologicalNode-based) ────────────────────────────────────────────

describe("parseCimXml — CIM 17 TopologicalNode topology", () => {
  it("reports version = '17'", () => {
    const result = parseCimXml(makeCim17Network());
    expect(result.version).toBe("17");
  });

  it("parses exactly 3 buses", () => {
    const result = parseCimXml(makeCim17Network());
    expect(result.buses).toHaveLength(3);
  });

  it("parses exactly 3 branches", () => {
    const result = parseCimXml(makeCim17Network());
    expect(result.branches).toHaveLength(3);
  });

  it("prefers TopologicalNode over ConnectivityNode when both present", () => {
    // Build a mixed CIM file with both TNs and CNs
    const body =
      baseVoltage("BV_138", 138) +
      topologicalNode("TN_1", "Bus_1", "BV_138") +
      topologicalNode("TN_2", "Bus_2", "BV_138") +
      voltageLevel("VL_1", "BV_138") +
      connectivityNode("CN_1", "Bus_1_CN", "VL_1") +
      connectivityNode("CN_2", "Bus_2_CN", "VL_1") +
      acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
      terminal("T_L12_1", "L12", 1, { tn: "TN_1", cn: "CN_1" }) +
      terminal("T_L12_2", "L12", 2, { tn: "TN_2", cn: "CN_2" });
    const xml = rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
    const result = parseCimXml(xml);
    expect(result.buses).toHaveLength(2); // 2 TN buses, not 4
  });

  it("resolves SLACK bus type from TopologicalIsland.AngleRefTopologicalNode", () => {
    const result = parseCimXml(makeCim17NetworkWithSlack("TN_1"));
    const slackBus = result.buses.find(b => b.busType === "SLACK");
    expect(slackBus).toBeDefined();
    expect(slackBus!.name).toBe("Bus_1");
  });

  it("exactly one bus is SLACK, others remain PQ", () => {
    const result = parseCimXml(makeCim17NetworkWithSlack("TN_1"));
    expect(result.buses.filter(b => b.busType === "SLACK")).toHaveLength(1);
    expect(result.buses.filter(b => b.busType === "PQ")).toHaveLength(2);
  });

  it("marks generator bus as PV", () => {
    const result = parseCimXml(makeCim17NetworkWithGenerator("TN_2"));
    const pvBus = result.buses.find(b => b.name === "Bus_2");
    expect(pvBus?.busType).toBe("PV");
  });

  it("does not mark non-generator buses as PV", () => {
    const result = parseCimXml(makeCim17NetworkWithGenerator("TN_2"));
    const nonPvBuses = result.buses.filter(b => b.name !== "Bus_2");
    expect(nonPvBuses.every(b => b.busType === "PQ")).toBe(true);
  });

  it("extracts generator with ratedS", () => {
    const result = parseCimXml(makeCim17NetworkWithGenerator("TN_2"));
    expect(result.generators).toHaveLength(1);
    expect(result.generators[0].name).toBe("Generator_1");
    expect(result.generators[0].ratedS).toBe(200);
  });
});

// ── CIM 16 ────────────────────────────────────────────────────────────────────

describe("parseCimXml — CIM 16 namespace", () => {
  it("detects CIM 16 and parses correctly", () => {
    const xml = makeLargeSyntheticNetwork(5, 5);
    const result = parseCimXml(xml);
    expect(result.version).toBe("16");
    expect(result.buses).toHaveLength(5);
    expect(result.branches).toHaveLength(5);
  });
});

// ── Transformer tap ratio ─────────────────────────────────────────────────────

describe("parseCimXml — transformer tap ratio computation", () => {
  it("computes tap_ratio = 1.0 for a nominal transformation (138/69, ratedU = 138/69)", () => {
    const xml = makeNetworkWithTransformer(138, 69, 138, 69);
    const result = parseCimXml(xml);
    const xfmr = result.branches.find(b => b.branchType === "TRANSFORMER");
    expect(xfmr).toBeDefined();
    expect(Math.abs(xfmr!.tapRatio - 1.0)).toBeLessThan(0.001);
  });

  it("computes off-nominal tap_ratio within 0.001 (132kV on 138kV base → 0.9565)", () => {
    // ratedU_from=132, baseKV_from=138 → 132/138 = 0.9565...
    // ratedU_to=69,  baseKV_to=69  → 69/69 = 1.0
    // tap_pu = 0.9565... / 1.0 = 0.9565...
    const xml = makeNetworkWithTransformer(138, 69, 132, 69);
    const result = parseCimXml(xml);
    const xfmr = result.branches.find(b => b.branchType === "TRANSFORMER");
    expect(xfmr).toBeDefined();
    const expectedTap = 132 / 138;
    expect(Math.abs(xfmr!.tapRatio - expectedTap)).toBeLessThan(0.001);
  });

  it("stores transformer as TRANSFORMER branchType (not LINE)", () => {
    const xml = makeNetworkWithTransformer(138, 69, 138, 69);
    const result = parseCimXml(xml);
    expect(result.branches.find(b => b.branchType === "TRANSFORMER")).toBeDefined();
    expect(result.branches.find(b => b.branchType === "LINE")).toBeUndefined();
  });

  it("sums winding r and x across both ends", () => {
    // Each end: r=0.001, x=0.05  → total r=0.002, x=0.1
    const xml = makeNetworkWithTransformer(138, 69, 138, 69);
    const result = parseCimXml(xml);
    const xfmr = result.branches.find(b => b.branchType === "TRANSFORMER");
    expect(Math.abs(xfmr!.rPu - 0.002)).toBeLessThan(1e-9);
    expect(Math.abs(xfmr!.xPu - 0.1)).toBeLessThan(1e-9);
  });

  it("skips transformer with x=0 and emits warning", () => {
    const body =
      baseVoltage("BV_H", 138) +
      baseVoltage("BV_L", 69) +
      topologicalNode("TN_H", "Bus_H", "BV_H") +
      topologicalNode("TN_L", "Bus_L", "BV_L") +
      powerTransformer("TR_Z", "ZeroXTransformer") +
      transformerEnd("TR_Z_W1", "TR_Z", 1, "T_TRZ_H", { r: 0, x: 0, b: 0, ratedU: 138 }) +
      transformerEnd("TR_Z_W2", "TR_Z", 2, "T_TRZ_L", { r: 0, x: 0, b: 0, ratedU: 69 }) +
      terminal("T_TRZ_H", "TR_Z_W1", 1, { tn: "TN_H" }) +
      terminal("T_TRZ_L", "TR_Z_W2", 2, { tn: "TN_L" });
    const xml = rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
    const result = parseCimXml(xml);
    expect(result.branches).toHaveLength(0);
    expect(result.warnings.some(w => w.toLowerCase().includes("x=0"))).toBe(true);
  });
});

// ── Cross-version equivalence ─────────────────────────────────────────────────

describe("CIM 14 vs CIM 17 cross-version equivalence", () => {
  it("produces the same bus count for the canonical 3-bus network", () => {
    const res14 = parseCimXml(makeCim14Network());
    const res17 = parseCimXml(makeCim17Network());
    expect(res14.buses.length).toBe(res17.buses.length);
  });

  it("produces the same branch count", () => {
    const res14 = parseCimXml(makeCim14Network());
    const res17 = parseCimXml(makeCim17Network());
    expect(res14.branches.length).toBe(res17.branches.length);
  });

  it("produces identical bus names (sorted)", () => {
    const res14 = parseCimXml(makeCim14Network());
    const res17 = parseCimXml(makeCim17Network());
    const names14 = res14.buses.map(b => b.name).sort();
    const names17 = res17.buses.map(b => b.name).sort();
    expect(names14).toEqual(names17);
  });

  it("produces identical base_kv for all buses", () => {
    const res14 = parseCimXml(makeCim14Network());
    const res17 = parseCimXml(makeCim17Network());
    const kvs14 = res14.buses.map(b => b.baseKv).sort((a, b) => a - b);
    const kvs17 = res17.buses.map(b => b.baseKv).sort((a, b) => a - b);
    expect(kvs14).toEqual(kvs17);
  });

  it("produces identical branch r/x/b parameters (sorted by name)", () => {
    const res14 = parseCimXml(makeCim14Network());
    const res17 = parseCimXml(makeCim17Network());

    const sort = (bs: CimBranch[]) =>
      [...bs].sort((a, b) => a.name.localeCompare(b.name));

    const br14 = sort(res14.branches);
    const br17 = sort(res17.branches);

    for (let i = 0; i < br14.length; i++) {
      expect(Math.abs(br14[i].rPu - br17[i].rPu)).toBeLessThan(1e-10);
      expect(Math.abs(br14[i].xPu - br17[i].xPu)).toBeLessThan(1e-10);
      expect(Math.abs(br14[i].bPu - br17[i].bPu)).toBeLessThan(1e-10);
    }
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("parseCimXml — edge cases", () => {
  it("throws on non-XML input", () => {
    expect(() => parseCimXml("this is not XML at all <<<>")).toThrow();
  });

  it("throws when rdf:RDF root is missing", () => {
    expect(() =>
      parseCimXml('<?xml version="1.0"?><note><body>Hello</body></note>')
    ).toThrow("[CimParser]");
  });

  it("skips ACLineSegment with fewer than 2 terminals", () => {
    const body =
      baseVoltage("BV_138", 138) +
      topologicalNode("TN_1", "Bus_1", "BV_138") +
      topologicalNode("TN_2", "Bus_2", "BV_138") +
      acLine("L12", "Line_1_2", 0.01938, 0.05917, 0.0528) +
      // Only 1 terminal — missing the second
      terminal("T_L12_1", "L12", 1, { tn: "TN_1" });
    const xml = rdfOpen(CIM17_NS) + body + "\n" + rdfClose;
    const result = parseCimXml(xml);
    expect(result.branches).toHaveLength(0);
    expect(result.warnings.some(w => w.includes("cannot resolve bus"))).toBe(true);
  });

  it("handles empty CIM file (no elements) without throwing", () => {
    const xml = rdfOpen(CIM17_NS) + rdfClose;
    const result = parseCimXml(xml);
    expect(result.buses).toHaveLength(0);
    expect(result.branches).toHaveLength(0);
  });
});

// ── Performance ───────────────────────────────────────────────────────────────

describe("parseCimXml — performance", () => {
  it("parses a synthetic 500-bus CIM 16 network in < 10 seconds", () => {
    const xml = makeLargeSyntheticNetwork(500, 550);
    const start = performance.now();
    const result = parseCimXml(xml);
    const elapsedMs = performance.now() - start;

    expect(result.buses).toHaveLength(500);
    expect(result.branches.length).toBeGreaterThanOrEqual(500);
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it("parses a synthetic 1354-bus CIM 16 network in < 10 seconds", () => {
    const xml = makeLargeSyntheticNetwork(1354, 1991); // PEGASE 1354 has 1991 branches
    const start = performance.now();
    const result = parseCimXml(xml);
    const elapsedMs = performance.now() - start;

    expect(result.buses).toHaveLength(1354);
    expect(result.branches.length).toBeGreaterThanOrEqual(1354);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});

// ── Integration tests (skipped without INTEGRATION=1) ────────────────────────

describe.skipIf(!INTEGRATION)(
  "parseCimXml — integration (requires real PEGASE file)",
  () => {
    it("parses PEGASE 1354-bus CIM file and verifies 1354 buses", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const xmlPath = path.join(process.cwd(), "test-fixtures", "PEGASE_1354.xml");
      const xml = fs.readFileSync(xmlPath, "utf8");
      const result = parseCimXml(xml);
      expect(result.buses).toHaveLength(1354);
      // PEGASE 1354 has 1991 branches
      expect(result.branches.length).toBeGreaterThanOrEqual(1800);
    });
  }
);
