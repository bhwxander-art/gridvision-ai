/**
 * IEC 61970 CIM XML Parser — INFRA-008
 *
 * Supports CIM 14, 16, and 17 namespace variants.
 * Extracts buses, branches, transformers, generators, and shunt devices.
 *
 * Two-pass strategy:
 *  Pass 1 — parse XML and collect all RDF elements into a flat lookup map
 *  Pass 2 — resolve terminal topology (equipment → terminal → bus)
 *           and build output records
 */

import { XMLParser } from "fast-xml-parser";

// ── CIM version detection ─────────────────────────────────────────────────────

export type CimVersion = "14" | "16" | "17";

const VERSION_PATTERNS: Array<[RegExp, CimVersion]> = [
  [/CIM-schema-cim14/, "14"],
  [/CIM-schema-cim15/, "16"], // treat CIM 15 as 16 (compatible profiles)
  [/CIM-schema-cim16/, "16"],
  [/CIM100/, "17"],
];

export function detectCimVersion(xmlSource: string): CimVersion {
  for (const [re, ver] of VERSION_PATTERNS) {
    if (re.test(xmlSource)) return ver;
  }
  return "16"; // safe default per IEC 61970-552 CGMES
}

// ── Element types we process  ─────────────────────────────────────────────────
// Anything else generates a warning rather than a parse failure.

const PROCESSED_TYPES = new Set([
  "BaseVoltage",
  "Substation",
  "VoltageLevel",
  "Bay",
  "ConnectivityNode",
  "TopologicalNode",
  "TopologicalIsland",
  "Terminal",
  "ACLineSegment",
  "PowerTransformer",
  "PowerTransformerEnd",
  "RatioTapChanger",
  "PhaseTapChangerLinear",
  "PhaseTapChangerAsymmetrical",
  "SynchronousMachine",
  "AsynchronousMachine",
  "GeneratingUnit",
  "HydroGeneratingUnit",
  "ThermalGeneratingUnit",
  "WindGeneratingUnit",
  "EnergyConsumer",
  "ConformLoad",
  "NonConformLoad",
  "LinearShuntCompensator",
  "StaticVarCompensator",
  "SeriesCompensator",
  "Breaker",
  "Disconnector",
  "LoadBreakSwitch",
  "Switch",
  "BusbarSection",
  "EquivalentInjection",
  "ExternalNetworkInjection",
  "GeographicalRegion",
  "SubGeographicalRegion",
  "ControlArea",
  "TieFlow",
]);

// ── Internal element representation ──────────────────────────────────────────

interface RawElement {
  id: string;
  type: string;
  name: string | null;
  attrs: Map<string, string>;  // property local name → string value
  refs: Map<string, string>;   // property local name → referenced element ID
}

// ── Output types ──────────────────────────────────────────────────────────────

export interface CimBus {
  cimId: string;
  busNumber: number;   // sequential 1-based integer assigned during parsing
  name: string;
  baseKv: number;
  busType: "PQ" | "PV" | "SLACK";
  zone: string | null;
}

export interface CimBranch {
  cimId: string;
  name: string;
  branchType: "LINE" | "TRANSFORMER" | "PHASE_SHIFTER";
  fromBusNumber: number;
  toBusNumber: number;
  rPu: number;
  xPu: number;
  bPu: number;
  tapRatio: number;       // per-unit turns ratio; 1.0 for lines
  phaseShiftDeg: number;  // phase shift angle; 0.0 for non-phase-shifters
  rateAMw: number;        // thermal rating in MW
}

export interface CimGenerator {
  cimId: string;
  name: string;
  busCimId: string;
  ratedS: number | null;  // rated apparent power in MVA
}

export interface CimShunt {
  cimId: string;
  name: string;
  busCimId: string;
  bPerSection: number;  // susceptance per section in per-unit
  sections: number;
}

export interface CimParseResult {
  version: CimVersion;
  buses: CimBus[];
  branches: CimBranch[];
  generators: CimGenerator[];
  shunts: CimShunt[];
  warnings: string[];
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function localName(qname: string): string {
  const i = qname.lastIndexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function propertyLocalName(propQName: string): string {
  // "cim:ACLineSegment.r"  → "r"
  // "cim:IdentifiedObject.name" → "name"
  // "cim:ACDCTerminal.sequenceNumber" → "sequenceNumber"
  const local = localName(propQName);
  const dot = local.lastIndexOf(".");
  return dot >= 0 ? local.slice(dot + 1) : local;
}

function stripHash(ref: string): string {
  return ref.startsWith("#") ? ref.slice(1) : ref;
}

function forceArr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function parseAttrNum(v: string | undefined | null): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

// ── Pass 1: Parse XML → flat element map ─────────────────────────────────────

function collectElements(xmlSource: string): {
  elements: Map<string, RawElement>;
  unknownTypes: Set<string>;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xmlSource) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `[CimParser] XML parse error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Locate rdf:RDF root element (handles any namespace prefix)
  let rdfRoot: Record<string, unknown> | null = null;
  for (const key of Object.keys(doc)) {
    if (!key.startsWith("@_") && localName(key) === "RDF") {
      rdfRoot = doc[key] as Record<string, unknown>;
      break;
    }
  }
  if (!rdfRoot) {
    throw new Error("[CimParser] Could not find rdf:RDF root element");
  }

  const elements = new Map<string, RawElement>();
  const unknownTypes = new Set<string>();

  for (const [tagKey, tagVal] of Object.entries(rdfRoot)) {
    if (tagKey.startsWith("@_") || tagKey === "#text") continue;

    const elemType = localName(tagKey);
    if (!PROCESSED_TYPES.has(elemType)) {
      unknownTypes.add(elemType);
      continue;
    }

    for (const rawElem of forceArr(tagVal as Record<string, unknown>)) {
      if (!rawElem || typeof rawElem !== "object" || Array.isArray(rawElem)) continue;
      const obj = rawElem as Record<string, unknown>;

      // Extract element ID from rdf:ID or rdf:about
      const rawId =
        (obj["@_rdf:ID"] as string | undefined) ??
        (obj["@_rdf:about"] as string | undefined);
      if (!rawId) continue;
      const id = stripHash(rawId);

      const elem: RawElement = {
        id,
        type: elemType,
        name: null,
        attrs: new Map(),
        refs: new Map(),
      };

      for (const [propKey, propVal] of Object.entries(obj)) {
        if (propKey.startsWith("@_") || propKey === "#text") continue;

        const prop = propertyLocalName(propKey);
        if (!prop) continue;

        if (propVal == null) {
          continue;
        } else if (typeof propVal === "string" || typeof propVal === "number") {
          const s = String(propVal).trim();
          if (prop === "name") elem.name = s;
          else elem.attrs.set(prop, s);
        } else if (typeof propVal === "object" && !Array.isArray(propVal)) {
          const obj2 = propVal as Record<string, unknown>;
          const res = obj2["@_rdf:resource"] as string | undefined;
          if (res) {
            elem.refs.set(prop, stripHash(res));
          } else {
            // Text node wrapped in object (e.g., has xml:lang attribute)
            const text = obj2["#text"];
            if (text != null) {
              const s = String(text).trim();
              if (prop === "name") elem.name = s;
              else elem.attrs.set(prop, s);
            }
          }
        } else if (Array.isArray(propVal) && propVal.length > 0) {
          const first = propVal[0];
          if (typeof first === "string" || typeof first === "number") {
            const s = String(first).trim();
            if (prop === "name") elem.name = s;
            else elem.attrs.set(prop, s);
          } else if (first && typeof first === "object") {
            const res = (first as Record<string, unknown>)["@_rdf:resource"] as string | undefined;
            if (res) elem.refs.set(prop, stripHash(res));
          }
        }
      }

      elements.set(id, elem);
    }
  }

  return { elements, unknownTypes };
}

// ── Pass 2: Resolve topology and build output ─────────────────────────────────

export function parseCimXml(xmlSource: string): CimParseResult {
  const version = detectCimVersion(xmlSource);
  const warnings: string[] = [];

  const { elements, unknownTypes } = collectElements(xmlSource);
  for (const t of unknownTypes) {
    warnings.push(`Unrecognized CIM element type ignored: ${t}`);
  }

  // BaseVoltage id → kV
  const baseVoltages = new Map<string, number>();
  for (const elem of elements.values()) {
    if (elem.type !== "BaseVoltage") continue;
    const kv = parseAttrNum(elem.attrs.get("nominalVoltage"));
    if (kv > 0) baseVoltages.set(elem.id, kv);
  }

  // VoltageLevel id → BaseVoltage id
  const vlBaseVoltage = new Map<string, string>();
  for (const elem of elements.values()) {
    if (elem.type !== "VoltageLevel") continue;
    const bvId = elem.refs.get("BaseVoltage");
    if (bvId) vlBaseVoltage.set(elem.id, bvId);
  }

  // Prefer TopologicalNodes when present (CIM 16/17); fall back to ConnectivityNodes (CIM 14)
  const hasTopologicalNodes = [...elements.values()].some(
    e => e.type === "TopologicalNode"
  );
  const busElemType = hasTopologicalNodes ? "TopologicalNode" : "ConnectivityNode";

  // Build buses
  const buses: CimBus[] = [];
  const busByIdMap = new Map<string, number>(); // cimId → busNumber
  let busCounter = 1;

  for (const elem of elements.values()) {
    if (elem.type !== busElemType) continue;

    let baseKv = 0;
    const bvId = elem.refs.get("BaseVoltage");
    if (bvId) {
      baseKv = baseVoltages.get(bvId) ?? 0;
    } else if (elem.type === "ConnectivityNode") {
      // CIM 14: base voltage is on the VoltageLevel container
      const containerId = elem.refs.get("ConnectivityNodeContainer");
      if (containerId) {
        const bvId2 = vlBaseVoltage.get(containerId);
        if (bvId2) baseKv = baseVoltages.get(bvId2) ?? 0;
      }
    }

    if (baseKv <= 0) {
      warnings.push(
        `Bus "${elem.name ?? elem.id}": no resolvable base voltage; skipping`
      );
      continue;
    }

    const num = busCounter++;
    busByIdMap.set(elem.id, num);
    buses.push({
      cimId: elem.id,
      busNumber: num,
      name: elem.name ?? `Bus_${num}`,
      baseKv,
      busType: "PQ",
      zone: null,
    });
  }

  // Identify SLACK bus from TopologicalIsland.AngleRefTopologicalNode
  for (const elem of elements.values()) {
    if (elem.type !== "TopologicalIsland") continue;
    const refId = elem.refs.get("AngleRefTopologicalNode");
    if (!refId) continue;
    const num = busByIdMap.get(refId);
    if (num != null) {
      const bus = buses.find(b => b.busNumber === num);
      if (bus) bus.busType = "SLACK";
    }
  }

  // Terminal → bus resolution
  // Prefer TopologicalNode reference when the model has TNs (CIM 16/17)
  const terminalBusMap = new Map<string, string>(); // terminalId → bus cimId
  for (const elem of elements.values()) {
    if (elem.type !== "Terminal") continue;
    const busId =
      (hasTopologicalNodes ? elem.refs.get("TopologicalNode") : null) ??
      elem.refs.get("ConnectivityNode");
    if (busId && busByIdMap.has(busId)) {
      terminalBusMap.set(elem.id, busId);
    }
  }

  // Equipment → terminals, sorted by sequenceNumber
  const equipTerminals = new Map<
    string,
    Array<{ termId: string; seq: number }>
  >();
  for (const elem of elements.values()) {
    if (elem.type !== "Terminal") continue;
    const eqId = elem.refs.get("ConductingEquipment");
    if (!eqId) continue;
    const seq = parseInt(elem.attrs.get("sequenceNumber") ?? "0", 10);
    const list = equipTerminals.get(eqId) ?? [];
    list.push({ termId: elem.id, seq });
    equipTerminals.set(eqId, list);
  }
  for (const list of equipTerminals.values()) {
    list.sort((a, b) => a.seq - b.seq);
  }

  // Mark PV buses from SynchronousMachine terminal connections
  for (const elem of elements.values()) {
    if (elem.type !== "SynchronousMachine") continue;
    for (const { termId } of equipTerminals.get(elem.id) ?? []) {
      const busId = terminalBusMap.get(termId);
      if (!busId) continue;
      const num = busByIdMap.get(busId);
      const bus = num != null ? buses.find(b => b.busNumber === num) : null;
      if (bus && bus.busType !== "SLACK") bus.busType = "PV";
    }
  }

  // Resolve from/to bus numbers for a 2-terminal conducting element
  function resolveEnds(
    equipId: string
  ): { fromNum: number; toNum: number } | null {
    const terms = equipTerminals.get(equipId) ?? [];
    if (terms.length < 2) return null;
    const fromCimId = terminalBusMap.get(terms[0].termId);
    const toCimId = terminalBusMap.get(terms[1].termId);
    if (!fromCimId || !toCimId) return null;
    const fromBusNum = busByIdMap.get(fromCimId);
    const toBusNum = busByIdMap.get(toCimId);
    if (fromBusNum == null || toBusNum == null || fromBusNum === toBusNum) return null;
    return { fromNum: fromBusNum, toNum: toBusNum };
  }

  const branches: CimBranch[] = [];
  let branchCounter = 1;

  // ACLineSegments → LINE
  for (const elem of elements.values()) {
    if (elem.type !== "ACLineSegment") continue;
    const ends = resolveEnds(elem.id);
    if (!ends) {
      warnings.push(
        `ACLineSegment "${elem.name ?? elem.id}": cannot resolve bus connections; skipping`
      );
      continue;
    }
    const x = parseAttrNum(elem.attrs.get("x"));
    if (x === 0) {
      warnings.push(
        `ACLineSegment "${elem.name ?? elem.id}": x=0 (short circuit); skipping`
      );
      continue;
    }
    // bch is line charging susceptance; some profiles use b
    const b = parseAttrNum(elem.attrs.get("bch") ?? elem.attrs.get("b"));
    branches.push({
      cimId: elem.id,
      name: elem.name ?? `Line_${branchCounter}`,
      branchType: "LINE",
      fromBusNumber: ends.fromNum,
      toBusNumber: ends.toNum,
      rPu: parseAttrNum(elem.attrs.get("r")),
      xPu: x,
      bPu: b,
      tapRatio: 1.0,
      phaseShiftDeg: 0.0,
      rateAMw: parseAttrNum(elem.attrs.get("ratedS")) || 9999.0,
    });
    branchCounter++;
  }

  // SeriesCompensator → LINE (series R/X element, no charging)
  for (const elem of elements.values()) {
    if (elem.type !== "SeriesCompensator") continue;
    const ends = resolveEnds(elem.id);
    if (!ends) continue;
    const x = parseAttrNum(elem.attrs.get("x"));
    if (x === 0) continue;
    branches.push({
      cimId: elem.id,
      name: elem.name ?? `SC_${branchCounter}`,
      branchType: "LINE",
      fromBusNumber: ends.fromNum,
      toBusNumber: ends.toNum,
      rPu: parseAttrNum(elem.attrs.get("r")),
      xPu: x,
      bPu: 0.0,
      tapRatio: 1.0,
      phaseShiftDeg: 0.0,
      rateAMw: 9999.0,
    });
    branchCounter++;
  }

  // PowerTransformers → TRANSFORMER
  for (const ptElem of elements.values()) {
    if (ptElem.type !== "PowerTransformer") continue;

    // Collect winding data sorted by endNumber
    const winds: Array<{
      endNum: number;
      r: number;
      x: number;
      b: number;
      ratedU: number;
      terminalId: string | null;
    }> = [];

    for (const endElem of elements.values()) {
      if (endElem.type !== "PowerTransformerEnd") continue;
      if (endElem.refs.get("PowerTransformer") !== ptElem.id) continue;
      winds.push({
        endNum: parseInt(endElem.attrs.get("endNumber") ?? "1", 10),
        r: parseAttrNum(endElem.attrs.get("r")),
        x: parseAttrNum(endElem.attrs.get("x")),
        b: parseAttrNum(endElem.attrs.get("b")),
        ratedU: parseAttrNum(endElem.attrs.get("ratedU")),
        terminalId: endElem.refs.get("Terminal") ?? null,
      });
    }

    winds.sort((a, b) => a.endNum - b.endNum);

    if (winds.length < 2) {
      warnings.push(
        `PowerTransformer "${ptElem.name ?? ptElem.id}": < 2 windings; skipping`
      );
      continue;
    }

    const [w1, w2] = winds;
    const fromBusId = w1.terminalId
      ? terminalBusMap.get(w1.terminalId)
      : null;
    const toBusId = w2.terminalId ? terminalBusMap.get(w2.terminalId) : null;

    if (!fromBusId || !toBusId) {
      warnings.push(
        `PowerTransformer "${ptElem.name ?? ptElem.id}": cannot resolve bus connections; skipping`
      );
      continue;
    }

    const fromBusNum = busByIdMap.get(fromBusId);
    const toBusNum = busByIdMap.get(toBusId);
    if (fromBusNum == null || toBusNum == null || fromBusNum === toBusNum) continue;

    const xTotal = w1.x + w2.x;
    if (xTotal === 0) {
      warnings.push(
        `PowerTransformer "${ptElem.name ?? ptElem.id}": x=0; skipping`
      );
      continue;
    }

    // Per-unit tap ratio:
    //   tap_pu = (ratedU_w1 / baseKV_from) / (ratedU_w2 / baseKV_to)
    // If ratedU == baseKV, tap_pu = 1.0 (nominal).  Off-nominal taps shift the ratio.
    let tapRatio = 1.0;
    if (w1.ratedU > 0 && w2.ratedU > 0) {
      const fromBus = buses.find(b => b.busNumber === fromBusNum);
      const toBus = buses.find(b => b.busNumber === toBusNum);
      if (fromBus && toBus && fromBus.baseKv > 0 && toBus.baseKv > 0) {
        tapRatio =
          (w1.ratedU / fromBus.baseKv) / (w2.ratedU / toBus.baseKv);
        tapRatio = Math.round(tapRatio * 1e6) / 1e6; // round to 6 dp
      }
    }

    branches.push({
      cimId: ptElem.id,
      name: ptElem.name ?? `TR_${branchCounter}`,
      branchType: "TRANSFORMER",
      fromBusNumber: fromBusNum,
      toBusNumber: toBusNum,
      rPu: w1.r + w2.r,
      xPu: xTotal,
      bPu: w1.b + w2.b,
      tapRatio,
      phaseShiftDeg: 0.0,
      rateAMw: 9999.0,
    });
    branchCounter++;
  }

  // Generators (SynchronousMachine / AsynchronousMachine)
  const generators: CimGenerator[] = [];
  for (const elem of elements.values()) {
    if (
      elem.type !== "SynchronousMachine" &&
      elem.type !== "AsynchronousMachine"
    )
      continue;
    let busCimId = "";
    for (const { termId } of equipTerminals.get(elem.id) ?? []) {
      const bid = terminalBusMap.get(termId);
      if (bid) {
        busCimId = bid;
        break;
      }
    }
    generators.push({
      cimId: elem.id,
      name: elem.name ?? `Gen_${elem.id.slice(0, 8)}`,
      busCimId,
      ratedS: parseAttrNum(elem.attrs.get("ratedS")) || null,
    });
  }

  // Shunts (LinearShuntCompensator / StaticVarCompensator)
  const shunts: CimShunt[] = [];
  for (const elem of elements.values()) {
    if (
      elem.type !== "LinearShuntCompensator" &&
      elem.type !== "StaticVarCompensator"
    )
      continue;
    let busCimId = "";
    for (const { termId } of equipTerminals.get(elem.id) ?? []) {
      const bid = terminalBusMap.get(termId);
      if (bid) {
        busCimId = bid;
        break;
      }
    }
    shunts.push({
      cimId: elem.id,
      name: elem.name ?? `Shunt_${elem.id.slice(0, 8)}`,
      busCimId,
      bPerSection: parseAttrNum(elem.attrs.get("bPerSection")),
      sections: parseAttrNum(elem.attrs.get("sections")) || 1,
    });
  }

  return { version, buses, branches, generators, shunts, warnings };
}
