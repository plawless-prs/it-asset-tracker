'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createBrowserClient } from '@supabase/ssr'

// ============================================================
// MATERIAL CALCULATOR — Rolls, Sheets, Slitting, Part Cutting
// Adapted for PRS Apps dark theme with Supabase storage
// ============================================================

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmtMoney = (n) =>
  isFinite(n)
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : "—";
const fmtNum = (n, d = 4) =>
  isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "—";
const num = (v) => {
  if (v === "" || v === "-" || v === "." || v === "-.") return 0;
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

// ---------- core math ----------
function rollTotals({ length, width, cost, costMode }) {
  const sqIn = length * 12 * width;
  const sqFt = sqIn / 144;
  const totalCost = costMode === "perFoot" ? cost * length : cost;
  const perFoot = length > 0 ? totalCost / length : 0;
  const perSqIn = sqIn > 0 ? totalCost / sqIn : 0;
  const perSqFt = sqFt > 0 ? totalCost / sqFt : 0;
  return { sqIn, sqFt, totalCost, perFoot, perSqIn, perSqFt };
}
function sheetTotals({ lengthFt, widthFt, cost }) {
  const sqIn = lengthFt * 12 * (widthFt * 12);
  const sqFt = lengthFt * widthFt;
  const perSqIn = sqIn > 0 ? cost / sqIn : 0;
  const perSqFt = sqFt > 0 ? cost / sqFt : 0;
  return { sqIn, sqFt, totalCost: cost, perSqIn, perSqFt };
}

// ---------- PRS Apps dark theme ----------
const COLORS = {
  bg: "#0b1017",
  bgAlt: "#0f1620",
  ink: "#e0e7f0",
  inkSoft: "#8aa0b8",
  muted: "#4a5a6e",
  line: "#182030",
  lineSoft: "#141d28",
  accent: "#2563eb",
  accentSoft: "#111d2e",
  green: "#4ade80",
  greenSoft: "#0d3320",
  red: "#f87171",
  shadow: "0 1px 2px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.15)",
  shadowLift: "0 2px 4px rgba(0,0,0,0.3), 0 8px 24px rgba(0,0,0,0.2)",
};

const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace";

const styles = {
  app: {
    fontFamily: FONT_SANS,
    background: COLORS.bg,
    color: COLORS.ink,
    minHeight: "100vh",
    padding: "28px 24px 64px",
  },
  shell: { maxWidth: 1100, margin: "0 auto" },
  header: {
    paddingBottom: 20,
    marginBottom: 24,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    flexWrap: "wrap",
    gap: 12,
    borderBottom: `1px solid ${COLORS.line}`,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    margin: 0,
    color: COLORS.ink,
    lineHeight: 1,
  },
  sub: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: COLORS.accent,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    marginTop: 6,
    fontWeight: 700,
  },
  version: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: COLORS.muted,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontWeight: 600,
  },
  tabs: {
    display: "flex",
    gap: 4,
    marginBottom: 24,
    padding: 4,
    background: COLORS.bgAlt,
    borderRadius: 10,
    border: `1px solid ${COLORS.line}`,
    boxShadow: COLORS.shadow,
    width: "fit-content",
    flexWrap: "wrap",
  },
  tab: (active) => ({
    padding: "10px 18px",
    fontFamily: FONT_MONO,
    fontSize: 12,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    background: active ? COLORS.accent : "transparent",
    color: active ? "#fff" : COLORS.inkSoft,
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontWeight: 700,
    transition: "all 0.15s ease",
  }),
  panel: {
    background: COLORS.bgAlt,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 12,
    padding: 24,
    marginBottom: 16,
    boxShadow: COLORS.shadow,
  },
  panelTitle: {
    fontFamily: FONT_MONO,
    fontSize: 12,
    letterSpacing: "0.15em",
    textTransform: "uppercase",
    color: COLORS.accent,
    marginBottom: 18,
    paddingBottom: 12,
    borderBottom: `1px solid ${COLORS.lineSoft}`,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
  },
  field: { display: "flex", flexDirection: "column", gap: 8 },
  label: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: COLORS.inkSoft,
    fontWeight: 700,
  },
  input: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.line}`,
    color: COLORS.ink,
    padding: "12px 14px",
    fontSize: 16,
    fontFamily: FONT_MONO,
    fontWeight: 500,
    outline: "none",
    borderRadius: 8,
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  },
  select: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.line}`,
    color: COLORS.ink,
    padding: "12px 14px",
    fontSize: 14,
    fontFamily: FONT_MONO,
    fontWeight: 600,
    outline: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  btn: {
    background: COLORS.accent,
    color: "#ffffff",
    border: "none",
    padding: "14px 24px",
    fontFamily: FONT_MONO,
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    borderRadius: 8,
    transition: "transform 0.1s ease, box-shadow 0.15s ease",
  },
  btnGhost: {
    background: COLORS.bg,
    color: COLORS.ink,
    border: `1px solid ${COLORS.line}`,
    padding: "11px 18px",
    fontFamily: FONT_MONO,
    fontSize: 12,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    cursor: "pointer",
    borderRadius: 8,
    fontWeight: 700,
  },
  btnDanger: {
    background: "transparent",
    color: COLORS.red,
    border: `1px solid ${COLORS.line}`,
    padding: "7px 11px",
    fontFamily: FONT_MONO,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    borderRadius: 6,
    lineHeight: 1,
  },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 1,
    background: COLORS.line,
    border: `1px solid ${COLORS.line}`,
    borderRadius: 10,
    overflow: "hidden",
  },
  stat: {
    background: COLORS.bgAlt,
    padding: "18px 20px",
  },
  statLabel: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: COLORS.inkSoft,
    marginBottom: 8,
    fontWeight: 700,
  },
  statValue: {
    fontFamily: FONT_MONO,
    fontSize: 22,
    fontWeight: 700,
    color: COLORS.ink,
    letterSpacing: "-0.01em",
  },
  cutRow: {
    display: "grid",
    gridTemplateColumns: "40px 1fr 1fr 1fr 1fr auto",
    gap: 10,
    alignItems: "center",
    padding: "14px 0",
    borderBottom: `1px solid ${COLORS.lineSoft}`,
  },
  cutHeader: {
    display: "grid",
    gridTemplateColumns: "40px 1fr 1fr 1fr 1fr auto",
    gap: 10,
    padding: "8px 0 14px",
    fontFamily: FONT_MONO,
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: COLORS.inkSoft,
    borderBottom: `1px solid ${COLORS.line}`,
    fontWeight: 700,
  },
  pieceCard: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.line}`,
    borderLeft: `3px solid ${COLORS.accent}`,
    padding: 20,
    marginBottom: 12,
    borderRadius: 10,
  },
  remnantCard: {
    background: COLORS.greenSoft,
    border: `1px solid ${COLORS.line}`,
    borderLeft: `3px solid ${COLORS.green}`,
    padding: 20,
    marginBottom: 12,
    borderRadius: 10,
  },
  pieceTitle: {
    fontFamily: FONT_MONO,
    fontSize: 13,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: COLORS.accent,
    marginBottom: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    fontWeight: 700,
  },
  bignum: {
    fontFamily: FONT_MONO,
    fontSize: 26,
    fontWeight: 700,
    color: COLORS.ink,
    letterSpacing: "-0.01em",
  },
  smallmuted: {
    fontFamily: FONT_MONO,
    fontSize: 11,
    color: COLORS.inkSoft,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginTop: 5,
    fontWeight: 600,
  },
  historyItem: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.line}`,
    padding: 18,
    marginBottom: 12,
    fontFamily: FONT_MONO,
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 10,
    color: COLORS.ink,
  },
  warn: {
    color: COLORS.red,
    fontFamily: FONT_MONO,
    fontSize: 12,
    fontWeight: 600,
    marginTop: 10,
    padding: "10px 14px",
    background: "#1a0f0f",
    border: `1px solid #991b1b`,
    borderRadius: 6,
  },
};

// ============================================================
// SHARED — ModeBanner
// ============================================================
function ModeBanner({ editMode, onNew, onSwitchToEdit }) {
  const isView = editMode === "view";
  const isEdit = editMode === "edit";
  const label = isView
    ? { text: "VIEWING SAVED RECORD", color: COLORS.muted, bg: COLORS.lineSoft }
    : isEdit
    ? { text: "EDITING SAVED RECORD", color: COLORS.accent, bg: COLORS.accentSoft }
    : { text: "NEW CALCULATION", color: COLORS.green, bg: COLORS.greenSoft };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 16px", background: label.bg, border: `1px solid ${COLORS.line}`, borderRadius: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", color: label.color }}>
        ● {label.text}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {isView && <button style={styles.btnGhost} onClick={onSwitchToEdit}>▸ Switch to Edit</button>}
        <button style={styles.btnGhost} onClick={onNew}>+ New Calculation</button>
      </div>
    </div>
  );
}

// ============================================================
// ROLL MODE
// ============================================================
function RollMode({ onSave, loadedJob, loadCounter, editMode, onNew, onSwitchToEdit }) {
  const isView = editMode === "view";
  const [jobName, setJobName] = useState("");
  const [length, setLength] = useState("100");
  const [width, setWidth] = useState("72");
  const [cost, setCost] = useState("100");
  const [costMode, setCostMode] = useState("total");
  const [markup, setMarkup] = useState("0");
  const [cuts, setCuts] = useState([{ id: 1, label: "Piece A", lengthFt: "100", widthIn: "54" }]);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    if (loadCounter === 0) return;
    if (!loadedJob) { setJobName(""); setLength("100"); setWidth("72"); setCost("100"); setCostMode("total"); setMarkup("0"); setCuts([{ id: 1, label: "Piece A", lengthFt: "100", widthIn: "54" }]); return; }
    if (loadedJob.type !== "roll") return;
    setJobName(loadedJob.jobName || "");
    setLength(String(loadedJob.master?.length ?? "100"));
    setWidth(String(loadedJob.master?.width ?? "72"));
    setCost(String(loadedJob.master?.cost ?? "100"));
    setCostMode("total");
    setMarkup(String(loadedJob.markup ?? "0"));
    if (Array.isArray(loadedJob.cuts) && loadedJob.cuts.length > 0) {
      setCuts(loadedJob.cuts.map((c, i) => ({ id: Date.now() + i, label: c.label || `Piece ${String.fromCharCode(65 + i)}`, lengthFt: String(c.lengthFt ?? ""), widthIn: String(c.widthIn ?? "") })));
    }
  }, [loadCounter]);

  const nLength = num(length), nWidth = num(width), nCost = num(cost), nMarkup = num(markup);
  const master = rollTotals({ length: nLength, width: nWidth, cost: nCost, costMode });
  const results = cuts.map((c) => { const lengthFt = num(c.lengthFt), widthIn = num(c.widthIn); const cSqIn = lengthFt * 12 * widthIn; const cCost = master.sqIn > 0 ? (cSqIn / master.sqIn) * master.totalCost : 0; const sell = cCost * (1 + nMarkup / 100); return { ...c, lengthFt, widthIn, sqIn: cSqIn, sqFt: cSqIn / 144, cost: cCost, sell }; });
  const usedSqIn = results.reduce((a, r) => a + r.sqIn, 0);
  const remnantSqIn = Math.max(0, master.sqIn - usedSqIn);
  const remnantCost = master.sqIn > 0 ? (remnantSqIn / master.sqIn) * master.totalCost : 0;
  const overCut = usedSqIn > master.sqIn + 0.001;

  const addCut = () => setCuts([...cuts, { id: Date.now(), label: `Piece ${String.fromCharCode(65 + cuts.length)}`, lengthFt: length, widthIn: "0" }]);
  const updateCut = (id, key, val) => setCuts(cuts.map((c) => (c.id === id ? { ...c, [key]: val } : c)));
  const removeCut = (id) => setCuts(cuts.filter((c) => c.id !== id));

  const save = () => {
    const result = onSave({ type: "roll", jobName: jobName.trim(), when: new Date().toISOString(), master: { length: nLength, width: nWidth, cost: master.totalCost }, cuts: results.map((r) => ({ label: r.label, lengthFt: r.lengthFt, widthIn: r.widthIn, cost: r.cost, sell: r.sell })), remnant: { sqIn: remnantSqIn, cost: remnantCost }, markup: nMarkup });
    if (result.ok) { setSaveMsg({ kind: "ok", text: result.mode === "updated" ? "✓ Changes saved" : "✓ Saved to history" }); }
    else if (result.reason === "no-name") { setSaveMsg({ kind: "dup", text: "Job name is required before saving" }); }
    else if (result.reason === "name-taken") { setSaveMsg({ kind: "dup", text: "That job name is already used — choose another" }); }
    else { setSaveMsg({ kind: "dup", text: "Already saved — change inputs to save again" }); }
    setTimeout(() => setSaveMsg(null), 4000);
  };

  return (
    <div>
      <ModeBanner editMode={editMode} onNew={onNew} onSwitchToEdit={onSwitchToEdit} />
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Job Name</div>
        <input style={{ ...styles.input, width: "100%", fontSize: 16 }} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Acme Conveyor Belt Order #4721" disabled={isView} />
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Master Roll Input</div>
        <div style={styles.grid}>
          <div style={styles.field}><label style={styles.label}>Length (ft)</label><input type="number" step="any" style={styles.input} value={length} onChange={(e) => setLength(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Width (in)</label><input type="number" step="any" style={styles.input} value={width} onChange={(e) => setWidth(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Cost Mode</label><select style={styles.select} value={costMode} onChange={(e) => setCostMode(e.target.value)} disabled={isView}><option value="total">Total roll $</option><option value="perFoot">$ per foot</option></select></div>
          <div style={styles.field}><label style={styles.label}>{costMode === "total" ? "Total Cost ($)" : "$ / ft"}</label><input type="number" step="any" style={styles.input} value={cost} onChange={(e) => setCost(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Markup %</label><input type="number" step="any" style={styles.input} value={markup} onChange={(e) => setMarkup(e.target.value)} disabled={isView} /></div>
        </div>
        <div style={{ ...styles.statGrid, marginTop: 18 }}>
          <div style={styles.stat}><div style={styles.statLabel}>Total Cost</div><div style={styles.statValue}>{fmtMoney(master.totalCost)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Foot</div><div style={styles.statValue}>{fmtMoney(master.perFoot)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq Ft</div><div style={styles.statValue}>{fmtMoney(master.perSqFt)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq In</div><div style={styles.statValue}>{fmtMoney(master.perSqIn)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>Total Sq Ft</div><div style={styles.statValue}>{fmtNum(master.sqFt, 2)}</div></div>
        </div>
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Cut List</div>
        <div style={styles.cutHeader}><div>#</div><div>Label</div><div>Length (ft)</div><div>Width (in)</div><div>Sq In</div><div></div></div>
        {cuts.map((c, i) => (
          <div key={c.id} style={styles.cutRow}>
            <div style={{ ...styles.smallmuted, fontSize: 14 }}>{i + 1}</div>
            <input style={styles.input} value={c.label} onChange={(e) => updateCut(c.id, "label", e.target.value)} disabled={isView} />
            <input type="number" step="any" style={styles.input} value={c.lengthFt} onChange={(e) => updateCut(c.id, "lengthFt", e.target.value)} disabled={isView} />
            <input type="number" step="any" style={styles.input} value={c.widthIn} onChange={(e) => updateCut(c.id, "widthIn", e.target.value)} disabled={isView} />
            <div style={{ fontFamily: FONT_MONO, fontSize: 16, fontWeight: 600, color: COLORS.ink }}>{fmtNum(num(c.lengthFt) * 12 * num(c.widthIn), 0)}</div>
            <button style={styles.btnDanger} onClick={() => removeCut(c.id)} disabled={isView}>×</button>
          </div>
        ))}
        <div style={{ marginTop: 14 }}><button style={styles.btnGhost} onClick={addCut} disabled={isView}>+ Add Cut</button></div>
        {overCut && <div style={styles.warn}>⚠ WARNING: Cut list exceeds master roll area by {fmtNum(usedSqIn - master.sqIn, 0)} sq in</div>}
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Breakdown</div>
        {results.map((r) => { const perSqIn = r.sqIn > 0 ? r.cost / r.sqIn : 0; const perSqFt = r.sqFt > 0 ? r.cost / r.sqFt : 0; const perFoot = r.lengthFt > 0 ? r.cost / r.lengthFt : 0; return (
          <div key={r.id} style={styles.pieceCard}>
            <div style={styles.pieceTitle}><span>{r.label} — {fmtNum(r.lengthFt, 2)} ft × {fmtNum(r.widthIn, 2)} in</span><span>{fmtNum(r.sqFt, 2)} sq ft</span></div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(r.cost)}</div><div style={styles.smallmuted}>material cost</div></div>
              <div><div style={styles.bignum}>{fmtMoney(perFoot)}</div><div style={styles.smallmuted}>$ / foot</div></div>
              <div><div style={styles.bignum}>{fmtMoney(perSqFt)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(perSqIn)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
            {nMarkup > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${COLORS.lineSoft}` }}><div style={{ ...styles.bignum, color: COLORS.accent }}>{fmtMoney(r.sell)}</div><div style={styles.smallmuted}>sell price (+{nMarkup}%)</div></div>}
          </div>
        ); })}
        {remnantSqIn > 0.001 && !overCut && (
          <div style={styles.remnantCard}>
            <div style={{ ...styles.pieceTitle, color: COLORS.green }}><span>REMNANT / SCRAP</span><span>{fmtNum(remnantSqIn / 144, 2)} sq ft ({fmtNum(remnantSqIn, 0)} sq in)</span></div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(remnantCost)}</div><div style={styles.smallmuted}>unrecovered cost</div></div>
              <div><div style={styles.bignum}>{fmtMoney(remnantSqIn > 0 ? remnantCost / (remnantSqIn / 144) : 0)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(remnantSqIn > 0 ? remnantCost / remnantSqIn : 0)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center" }}>
          {!isView && <button style={styles.btn} onClick={save}>▸ Save to History</button>}
          {saveMsg && <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: saveMsg.kind === "ok" ? COLORS.green : COLORS.accent }}>{saveMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SHEET MODE
// ============================================================
function SheetMode({ onSave, loadedJob, loadCounter, editMode, onNew, onSwitchToEdit }) {
  const isView = editMode === "view";
  const [jobName, setJobName] = useState("");
  const [lengthFt, setLengthFt] = useState("10");
  const [widthFt, setWidthFt] = useState("4");
  const [cost, setCost] = useState("200");
  const [markup, setMarkup] = useState("0");
  const [parts, setParts] = useState([{ id: 1, label: "Part 1", mode: "sqin", sqIn: "150", lengthIn: "0", widthIn: "0", qty: "1" }]);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    if (loadCounter === 0) return;
    if (!loadedJob) { setJobName(""); setLengthFt("10"); setWidthFt("4"); setCost("200"); setMarkup("0"); setParts([{ id: 1, label: "Part 1", mode: "sqin", sqIn: "150", lengthIn: "0", widthIn: "0", qty: "1" }]); return; }
    if (loadedJob.type !== "sheet") return;
    setJobName(loadedJob.jobName || "");
    setLengthFt(String(loadedJob.sheet?.lengthFt ?? "10"));
    setWidthFt(String(loadedJob.sheet?.widthFt ?? "4"));
    setCost(String(loadedJob.sheet?.cost ?? "200"));
    setMarkup(String(loadedJob.markup ?? "0"));
    if (Array.isArray(loadedJob.parts) && loadedJob.parts.length > 0) {
      setParts(loadedJob.parts.map((p, i) => ({ id: Date.now() + i, label: p.label || `Part ${i + 1}`, mode: p.mode || "sqin", sqIn: String(p.sqIn ?? p.perSqIn ?? "0"), lengthIn: String(p.lengthIn ?? "0"), widthIn: String(p.widthIn ?? "0"), qty: String(p.qty ?? "1") })));
    }
  }, [loadCounter]);

  const nLengthFt = num(lengthFt), nWidthFt = num(widthFt), nCost = num(cost), nMarkup = num(markup);
  const sheet = sheetTotals({ lengthFt: nLengthFt, widthFt: nWidthFt, cost: nCost });
  const results = parts.map((p) => { const sqIn = num(p.sqIn); const lIn = num(p.lengthIn); const wIn = num(p.widthIn); const qty = Math.max(1, Math.floor(num(p.qty)) || 1); const per = p.mode === "sqin" ? sqIn : lIn * wIn; const totalSqIn = per * qty; const c = per * sheet.perSqIn; const totalCost = c * qty; const sell = totalCost * (1 + nMarkup / 100); return { ...p, qty, perSqIn: per, totalSqIn, unitCost: c, totalCost, sell }; });
  const usedSqIn = results.reduce((a, r) => a + r.totalSqIn, 0);
  const remnantSqIn = Math.max(0, sheet.sqIn - usedSqIn);
  const remnantCost = sheet.sqIn > 0 ? (remnantSqIn / sheet.sqIn) * sheet.totalCost : 0;
  const overCut = usedSqIn > sheet.sqIn + 0.001;

  const addPart = () => setParts([...parts, { id: Date.now(), label: `Part ${parts.length + 1}`, mode: "sqin", sqIn: "0", lengthIn: "0", widthIn: "0", qty: "1" }]);
  const updatePart = (id, key, val) => setParts(parts.map((p) => (p.id === id ? { ...p, [key]: val } : p)));
  const removePart = (id) => setParts(parts.filter((p) => p.id !== id));

  const save = () => {
    const result = onSave({ type: "sheet", jobName: jobName.trim(), when: new Date().toISOString(), sheet: { lengthFt: nLengthFt, widthFt: nWidthFt, cost: nCost }, parts: results.map((r) => ({ label: r.label, qty: r.qty, mode: r.mode, sqIn: r.mode === "sqin" ? num(r.sqIn) : 0, lengthIn: r.mode === "lw" ? num(r.lengthIn) : 0, widthIn: r.mode === "lw" ? num(r.widthIn) : 0, perSqIn: r.perSqIn, totalCost: r.totalCost, sell: r.sell })), remnant: { sqIn: remnantSqIn, cost: remnantCost }, markup: nMarkup });
    if (result.ok) { setSaveMsg({ kind: "ok", text: result.mode === "updated" ? "✓ Changes saved" : "✓ Saved to history" }); }
    else if (result.reason === "no-name") { setSaveMsg({ kind: "dup", text: "Job name is required before saving" }); }
    else if (result.reason === "name-taken") { setSaveMsg({ kind: "dup", text: "That job name is already used — choose another" }); }
    else { setSaveMsg({ kind: "dup", text: "Already saved — change inputs to save again" }); }
    setTimeout(() => setSaveMsg(null), 4000);
  };

  return (
    <div>
      <ModeBanner editMode={editMode} onNew={onNew} onSwitchToEdit={onSwitchToEdit} />
      <div style={styles.panel}><div style={styles.panelTitle}>◆ Job Name</div><input style={{ ...styles.input, width: "100%", fontSize: 16 }} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Acme Gasket Job #2210" disabled={isView} /></div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Master Sheet Input</div>
        <div style={styles.grid}>
          <div style={styles.field}><label style={styles.label}>Length (ft)</label><input type="number" step="any" style={styles.input} value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Width (ft)</label><input type="number" step="any" style={styles.input} value={widthFt} onChange={(e) => setWidthFt(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Sheet Cost ($)</label><input type="number" step="any" style={styles.input} value={cost} onChange={(e) => setCost(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Markup %</label><input type="number" step="any" style={styles.input} value={markup} onChange={(e) => setMarkup(e.target.value)} disabled={isView} /></div>
        </div>
        <div style={{ ...styles.statGrid, marginTop: 18 }}>
          <div style={styles.stat}><div style={styles.statLabel}>Sheet Cost</div><div style={styles.statValue}>{fmtMoney(sheet.totalCost)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq Ft</div><div style={styles.statValue}>{fmtMoney(sheet.perSqFt)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq In</div><div style={styles.statValue}>{fmtMoney(sheet.perSqIn)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>Total Sq In</div><div style={styles.statValue}>{fmtNum(sheet.sqIn, 0)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>Total Sq Ft</div><div style={styles.statValue}>{fmtNum(sheet.sqFt, 2)}</div></div>
        </div>
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Parts List</div>
        {parts.map((p, i) => (
          <div key={p.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.line}`, padding: 12, marginBottom: 10, borderRadius: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ ...styles.smallmuted, fontSize: 14, minWidth: 24 }}>{i + 1}</div>
              <input style={{ ...styles.input, flex: 1 }} value={p.label} onChange={(e) => updatePart(p.id, "label", e.target.value)} placeholder="Part label" disabled={isView} />
              <select style={styles.select} value={p.mode} onChange={(e) => updatePart(p.id, "mode", e.target.value)} disabled={isView}><option value="sqin">Sq In direct</option><option value="lw">Length × Width</option></select>
              <button style={styles.btnDanger} onClick={() => removePart(p.id)} disabled={isView}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10 }}>
              {p.mode === "sqin" ? (
                <div style={styles.field}><label style={styles.label}>Sq In per part</label><input type="number" step="any" style={styles.input} value={p.sqIn} onChange={(e) => updatePart(p.id, "sqIn", e.target.value)} disabled={isView} /></div>
              ) : (
                <><div style={styles.field}><label style={styles.label}>Length (in)</label><input type="number" step="any" style={styles.input} value={p.lengthIn} onChange={(e) => updatePart(p.id, "lengthIn", e.target.value)} disabled={isView} /></div>
                <div style={styles.field}><label style={styles.label}>Width (in)</label><input type="number" step="any" style={styles.input} value={p.widthIn} onChange={(e) => updatePart(p.id, "widthIn", e.target.value)} disabled={isView} /></div></>
              )}
              <div style={styles.field}><label style={styles.label}>Qty</label><input type="number" step="any" style={styles.input} value={p.qty} onChange={(e) => updatePart(p.id, "qty", e.target.value)} disabled={isView} /></div>
            </div>
          </div>
        ))}
        <button style={styles.btnGhost} onClick={addPart} disabled={isView}>+ Add Part</button>
        {overCut && <div style={styles.warn}>⚠ WARNING: Parts list exceeds sheet area by {fmtNum(usedSqIn - sheet.sqIn, 0)} sq in</div>}
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Breakdown</div>
        {results.map((r) => (
          <div key={r.id} style={styles.pieceCard}>
            <div style={styles.pieceTitle}><span>{r.label} × {r.qty} — {fmtNum(r.perSqIn, 2)} sq in ea</span><span>{fmtNum(r.totalSqIn, 0)} sq in total</span></div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(r.unitCost)}</div><div style={styles.smallmuted}>cost per part</div></div>
              <div><div style={styles.bignum}>{fmtMoney(r.totalCost)}</div><div style={styles.smallmuted}>total material cost</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqFt)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqIn)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
            {nMarkup > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${COLORS.lineSoft}` }}><div style={{ ...styles.bignum, color: COLORS.accent }}>{fmtMoney(r.sell)}</div><div style={styles.smallmuted}>sell price (+{nMarkup}%)</div></div>}
          </div>
        ))}
        {remnantSqIn > 0.001 && !overCut && (
          <div style={styles.remnantCard}>
            <div style={{ ...styles.pieceTitle, color: COLORS.green }}><span>REMNANT / SCRAP</span><span>{fmtNum(remnantSqIn / 144, 2)} sq ft ({fmtNum(remnantSqIn, 0)} sq in)</span></div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(remnantCost)}</div><div style={styles.smallmuted}>unrecovered cost</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqFt)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqIn)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center" }}>
          {!isView && <button style={styles.btn} onClick={save}>▸ Save to History</button>}
          {saveMsg && <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: saveMsg.kind === "ok" ? COLORS.green : COLORS.accent }}>{saveMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// GASKET MODE
// ============================================================
function GasketMode({ onSave, loadedJob, loadCounter, editMode, onNew, onSwitchToEdit }) {
  const isView = editMode === "view";
  const [jobName, setJobName] = useState("");
  const [lengthFt, setLengthFt] = useState("10");
  const [widthFt, setWidthFt] = useState("4");
  const [cost, setCost] = useState("200");
  const [markup, setMarkup] = useState("0");
  const [shopRate, setShopRate] = useState("150");
  const [marginPct, setMarginPct] = useState("25");
  const [costBasis, setCostBasis] = useState("withDrop");
  const [gaskets, setGaskets] = useState([{ id: 1, label: "Gasket 1", type: "ring", od: "6", innerId: "4", qty: "1", minutes: "0" }]);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    if (loadCounter === 0) return;
    if (!loadedJob) { setJobName(""); setLengthFt("10"); setWidthFt("4"); setCost("200"); setMarkup("0"); setShopRate("150"); setMarginPct("25"); setCostBasis("withDrop"); setGaskets([{ id: 1, label: "Gasket 1", type: "ring", od: "6", innerId: "4", qty: "1", minutes: "0" }]); return; }
    if (loadedJob.type !== "gasket") return;
    setJobName(loadedJob.jobName || "");
    setLengthFt(String(loadedJob.sheet?.lengthFt ?? "10"));
    setWidthFt(String(loadedJob.sheet?.widthFt ?? "4"));
    setCost(String(loadedJob.sheet?.cost ?? "200"));
    setMarkup(String(loadedJob.markup ?? "0"));
    if (loadedJob.pricing) { setShopRate(String(loadedJob.pricing.shopRate ?? "150")); setMarginPct(String(loadedJob.pricing.marginPct ?? "25")); setCostBasis(loadedJob.pricing.costBasis || "withDrop"); }
    if (Array.isArray(loadedJob.gaskets) && loadedJob.gaskets.length > 0) {
      setGaskets(loadedJob.gaskets.map((g, i) => ({ id: Date.now() + i, label: g.label || `Gasket ${i + 1}`, type: g.gtype || "ring", od: String(g.od ?? "0"), innerId: String(g.innerId ?? "0"), qty: String(g.qty ?? "1"), minutes: String(g.minutes ?? "0") })));
    }
  }, [loadCounter]);

  const nLengthFt = num(lengthFt), nWidthFt = num(widthFt), nCost = num(cost), nMarkup = num(markup), nShopRate = num(shopRate), nMarginPct = num(marginPct);
  const sheet = sheetTotals({ lengthFt: nLengthFt, widthFt: nWidthFt, cost: nCost });
  const divisor = 1 - nMarginPct / 100;

  const results = gaskets.map((g) => {
    const od = num(g.od); const id = g.type === "ff" ? 0 : num(g.innerId); const qty = Math.max(1, Math.floor(num(g.qty)) || 1); const minutes = num(g.minutes);
    const gasketArea = Math.PI * ((od / 2) ** 2 - (id / 2) ** 2); const boundingArea = od * od; const innerDisc = Math.PI * (id / 2) ** 2;
    const totalGasketArea = gasketArea * qty; const totalBounding = boundingArea * qty; const totalInnerDisc = innerDisc * qty;
    const unitCost = boundingArea * sheet.perSqIn; const totalCost = unitCost * qty;
    const faceUnitCost = gasketArea * sheet.perSqIn; const faceTotalCost = faceUnitCost * qty;
    const sell = totalCost * (1 + nMarkup / 100);
    const laborPerGasket = nShopRate * (minutes / 60);
    const basisUnit = costBasis === "faceOnly" ? faceUnitCost : unitCost;
    const combinedUnit = basisUnit + laborPerGasket;
    const salePerGasket = divisor > 0 ? combinedUnit / divisor : 0;
    const saleTotal = salePerGasket * qty;
    return { ...g, od, innerId: id, qty, minutes, gasketArea, boundingArea, innerDisc, totalGasketArea, totalBounding, totalInnerDisc, unitCost, totalCost, faceUnitCost, faceTotalCost, sell, laborPerGasket, basisUnit, combinedUnit, salePerGasket, saleTotal };
  });

  const usedBounding = results.reduce((a, r) => a + r.totalBounding, 0);
  const innerRecoverable = results.reduce((a, r) => a + r.totalInnerDisc, 0);
  const outerRemnantSqIn = Math.max(0, sheet.sqIn - usedBounding);
  const outerRemnantCost = sheet.sqIn > 0 ? (outerRemnantSqIn / sheet.sqIn) * sheet.totalCost : 0;
  const innerRemnantCost = sheet.sqIn > 0 ? (innerRecoverable / sheet.sqIn) * sheet.totalCost : 0;
  const overCut = usedBounding > sheet.sqIn + 0.001;

  const addGasket = () => setGaskets([...gaskets, { id: Date.now(), label: `Gasket ${gaskets.length + 1}`, type: "ring", od: "0", innerId: "0", qty: "1", minutes: "0" }]);
  const updateGasket = (id, key, val) => setGaskets(gaskets.map((g) => (g.id === id ? { ...g, [key]: val } : g)));
  const removeGasket = (id) => setGaskets(gaskets.filter((g) => g.id !== id));

  const save = () => {
    const result = onSave({ type: "gasket", jobName: jobName.trim(), when: new Date().toISOString(), sheet: { lengthFt: nLengthFt, widthFt: nWidthFt, cost: nCost }, gaskets: results.map((r) => ({ label: r.label, gtype: r.type, od: r.od, innerId: r.innerId, qty: r.qty, minutes: r.minutes, gasketArea: r.gasketArea, totalCost: r.totalCost, sell: r.sell, salePerGasket: r.salePerGasket, saleTotal: r.saleTotal })), outerRemnant: { sqIn: outerRemnantSqIn, cost: outerRemnantCost }, innerRemnant: { sqIn: innerRecoverable, cost: innerRemnantCost }, markup: nMarkup, pricing: { shopRate: nShopRate, marginPct: nMarginPct, costBasis } });
    if (result.ok) { setSaveMsg({ kind: "ok", text: result.mode === "updated" ? "✓ Changes saved" : "✓ Saved to history" }); }
    else if (result.reason === "no-name") { setSaveMsg({ kind: "dup", text: "Job name is required before saving" }); }
    else if (result.reason === "name-taken") { setSaveMsg({ kind: "dup", text: "That job name is already used — choose another" }); }
    else { setSaveMsg({ kind: "dup", text: "Already saved — change inputs to save again" }); }
    setTimeout(() => setSaveMsg(null), 4000);
  };

  return (
    <div>
      <ModeBanner editMode={editMode} onNew={onNew} onSwitchToEdit={onSwitchToEdit} />
      <div style={styles.panel}><div style={styles.panelTitle}>◆ Job Name</div><input style={{ ...styles.input, width: "100%", fontSize: 16 }} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Acme Flange Gaskets Job #3315" disabled={isView} /></div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Master Sheet Input</div>
        <div style={styles.grid}>
          <div style={styles.field}><label style={styles.label}>Length (ft)</label><input type="number" step="any" style={styles.input} value={lengthFt} onChange={(e) => setLengthFt(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Width (ft)</label><input type="number" step="any" style={styles.input} value={widthFt} onChange={(e) => setWidthFt(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Sheet Cost ($)</label><input type="number" step="any" style={styles.input} value={cost} onChange={(e) => setCost(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Markup %</label><input type="number" step="any" style={styles.input} value={markup} onChange={(e) => setMarkup(e.target.value)} disabled={isView} /></div>
        </div>
        <div style={{ ...styles.statGrid, marginTop: 18 }}>
          <div style={styles.stat}><div style={styles.statLabel}>Sheet Cost</div><div style={styles.statValue}>{fmtMoney(sheet.totalCost)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq Ft</div><div style={styles.statValue}>{fmtMoney(sheet.perSqFt)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>$ / Sq In</div><div style={styles.statValue}>{fmtMoney(sheet.perSqIn)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>Total Sq In</div><div style={styles.statValue}>{fmtNum(sheet.sqIn, 0)}</div></div>
          <div style={styles.stat}><div style={styles.statLabel}>Total Sq Ft</div><div style={styles.statValue}>{fmtNum(sheet.sqFt, 2)}</div></div>
        </div>
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Gasket List</div>
        <div style={{ ...styles.smallmuted, marginBottom: 10 }}>Cost is based on the OD bounding square actually consumed from the sheet. Inner disc on ring gaskets is tracked as a recoverable remnant.</div>
        {gaskets.map((g, i) => (
          <div key={g.id} style={{ background: COLORS.bg, border: `1px solid ${COLORS.line}`, padding: 12, marginBottom: 10, borderRadius: 8 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <div style={{ ...styles.smallmuted, fontSize: 14, minWidth: 24 }}>{i + 1}</div>
              <input style={{ ...styles.input, flex: 1 }} value={g.label} onChange={(e) => updateGasket(g.id, "label", e.target.value)} placeholder="Gasket label" disabled={isView} />
              <select style={styles.select} value={g.type} onChange={(e) => updateGasket(g.id, "type", e.target.value)} disabled={isView}><option value="ring">Ring</option><option value="ff">Full Face</option></select>
              <button style={styles.btnDanger} onClick={() => removeGasket(g.id)} disabled={isView}>×</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10 }}>
              <div style={styles.field}><label style={styles.label}>OD (in)</label><input type="number" step="any" style={styles.input} value={g.od} onChange={(e) => updateGasket(g.id, "od", e.target.value)} disabled={isView} /></div>
              {g.type === "ring" && <div style={styles.field}><label style={styles.label}>ID (in)</label><input type="number" step="any" style={styles.input} value={g.innerId} onChange={(e) => updateGasket(g.id, "innerId", e.target.value)} disabled={isView} /></div>}
              <div style={styles.field}><label style={styles.label}>Qty</label><input type="number" step="any" style={styles.input} value={g.qty} onChange={(e) => updateGasket(g.id, "qty", e.target.value)} disabled={isView} /></div>
              <div style={styles.field}><label style={styles.label}>Minutes ea</label><input type="number" step="any" style={styles.input} value={g.minutes} onChange={(e) => updateGasket(g.id, "minutes", e.target.value)} disabled={isView} /></div>
            </div>
          </div>
        ))}
        <button style={styles.btnGhost} onClick={addGasket} disabled={isView}>+ Add Gasket</button>
        {overCut && <div style={styles.warn}>⚠ WARNING: Gasket bounding area exceeds sheet by {fmtNum(usedBounding - sheet.sqIn, 0)} sq in</div>}
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Pricing (Labor + Margin)</div>
        <div style={styles.grid}>
          <div style={styles.field}><label style={styles.label}>Shop Rate ($/hr)</label><input type="number" step="any" style={styles.input} value={shopRate} onChange={(e) => setShopRate(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Margin %</label><input type="number" step="any" style={styles.input} value={marginPct} onChange={(e) => setMarginPct(e.target.value)} disabled={isView} /></div>
          <div style={styles.field}><label style={styles.label}>Cost Basis</label><select style={styles.select} value={costBasis} onChange={(e) => setCostBasis(e.target.value)} disabled={isView}><option value="withDrop">Cost per gasket (w/ drop)</option><option value="faceOnly">Face-only cost</option></select></div>
        </div>
        <div style={{ ...styles.smallmuted, marginTop: 14, textTransform: "none", letterSpacing: "0.02em", fontSize: 12 }}>Formula: (material + labor) ÷ (1 − margin%). Labor per gasket = shop rate × each gasket's own minutes.</div>
        {nMarginPct >= 100 && <div style={styles.warn}>⚠ Margin % must be less than 100</div>}
      </div>
      <div style={styles.panel}>
        <div style={styles.panelTitle}>◆ Breakdown</div>
        {results.map((r) => (
          <div key={r.id} style={styles.pieceCard}>
            <div style={styles.pieceTitle}><span>{r.label} × {r.qty} — {r.type === "ff" ? "FF" : "RING"} {fmtNum(r.od, 2)}" OD{r.type === "ring" ? ` × ${fmtNum(r.innerId, 2)}" ID` : ""}</span><span>{fmtNum(r.gasketArea, 2)} sq in face (per gasket)</span></div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(r.unitCost)}</div><div style={styles.smallmuted}>cost per gasket (w/ drop)</div></div>
              <div><div style={styles.bignum}>{fmtMoney(r.totalCost)}</div><div style={styles.smallmuted}>total cost (w/ drop)</div></div>
              <div><div style={{ ...styles.bignum, color: COLORS.green }}>{fmtMoney(r.faceUnitCost)}</div><div style={styles.smallmuted}>face-only cost ea</div></div>
              <div><div style={{ ...styles.bignum, color: COLORS.green }}>{fmtMoney(r.faceTotalCost)}</div><div style={styles.smallmuted}>face-only total</div></div>
              <div><div style={styles.bignum}>{fmtNum(r.boundingArea, 2)}</div><div style={styles.smallmuted}>sq in consumed (per gasket)</div></div>
              {r.type === "ring" && <div><div style={styles.bignum}>{fmtNum(r.innerDisc, 2)}</div><div style={styles.smallmuted}>center drop sq in (per gasket)</div></div>}
            </div>
            {(r.minutes > 0 || nMarginPct > 0) && nMarginPct < 100 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${COLORS.lineSoft}`, display: "flex", gap: 30, flexWrap: "wrap" }}>
                <div><div style={{ ...styles.bignum, color: COLORS.accent }}>{fmtMoney(r.salePerGasket)}</div><div style={styles.smallmuted}>sale price per gasket</div></div>
                <div><div style={{ ...styles.bignum, color: COLORS.accent }}>{fmtMoney(r.saleTotal)}</div><div style={styles.smallmuted}>total job sale price</div></div>
                <div><div style={styles.bignum}>{fmtMoney(r.laborPerGasket)}</div><div style={styles.smallmuted}>labor ea ({fmtNum(r.minutes, 2)} min)</div></div>
              </div>
            )}
            {nMarkup > 0 && <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${COLORS.lineSoft}` }}><div style={{ ...styles.bignum, color: COLORS.accent }}>{fmtMoney(r.sell)}</div><div style={styles.smallmuted}>sell price (+{nMarkup}% markup)</div></div>}
          </div>
        ))}
        {outerRemnantSqIn > 0.001 && !overCut && (
          <div style={styles.remnantCard}>
            <div style={{ ...styles.pieceTitle, color: COLORS.green }}><span>OUTER REMNANT / SCRAP</span><span>{fmtNum(outerRemnantSqIn / 144, 2)} sq ft ({fmtNum(outerRemnantSqIn, 0)} sq in)</span></div>
            <div style={{ ...styles.smallmuted, marginBottom: 8 }}>Material left on the sheet after gasket bounding squares are removed</div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(outerRemnantCost)}</div><div style={styles.smallmuted}>unrecovered cost</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqFt)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqIn)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
          </div>
        )}
        {innerRecoverable > 0.001 && (
          <div style={styles.remnantCard}>
            <div style={{ ...styles.pieceTitle, color: COLORS.green }}><span>INNER DISC REMNANT</span><span>{fmtNum(innerRecoverable / 144, 2)} sq ft ({fmtNum(innerRecoverable, 0)} sq in)</span></div>
            <div style={{ ...styles.smallmuted, marginBottom: 8 }}>Recoverable center discs from ring gaskets — potentially reusable material</div>
            <div style={{ display: "flex", gap: 30, flexWrap: "wrap" }}>
              <div><div style={styles.bignum}>{fmtMoney(innerRemnantCost)}</div><div style={styles.smallmuted}>material value</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqFt)}</div><div style={styles.smallmuted}>$ / sq ft</div></div>
              <div><div style={styles.bignum}>{fmtMoney(sheet.perSqIn)}</div><div style={styles.smallmuted}>$ / sq in</div></div>
            </div>
          </div>
        )}
        <div style={{ marginTop: 14, display: "flex", gap: 14, alignItems: "center" }}>
          {!isView && <button style={styles.btn} onClick={save}>▸ Save to History</button>}
          {saveMsg && <span style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: saveMsg.kind === "ok" ? COLORS.green : COLORS.accent }}>{saveMsg.text}</span>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// HISTORY
// ============================================================
function History({ items, onClear, onDelete, onView, onEdit, onDuplicate }) {
  if (!items.length) {
    return <div style={styles.panel}><div style={styles.panelTitle}>◆ History</div><div style={styles.smallmuted}>No saved calculations yet.</div></div>;
  }
  return (
    <div style={styles.panel}>
      <div style={{ ...styles.panelTitle, display: "flex", justifyContent: "space-between" }}><span>◆ History ({items.length})</span><button style={styles.btnDanger} onClick={onClear}>Clear All</button></div>
      {items.map((h, i) => {
        const safeWhen = (() => { try { return new Date(h.when).toLocaleString(); } catch { return "—"; } })();
        const safeEdited = h.editedAt ? (() => { try { return new Date(h.editedAt).toLocaleString(); } catch { return null; } })() : null;
        return (
          <div key={h.id || i} style={styles.historyItem}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.ink, marginBottom: 2 }}>{h.jobName || "(Untitled Job)"}</div>
                <div style={{ color: COLORS.accent, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 10 }}>
                  {h.type || "?"} — created {safeWhen}
                  {safeEdited && <span style={{ color: COLORS.muted }}> · edited {safeEdited}</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={styles.btnGhost} onClick={() => onView(h)}>▸ View</button>
                <button style={styles.btnGhost} onClick={() => onEdit(h)}>▸ Edit</button>
                <button style={styles.btnGhost} onClick={() => onDuplicate(h)}>▸ Duplicate</button>
                <button style={styles.btnDanger} onClick={() => onDelete(h.id)}>×</button>
              </div>
            </div>
            {h.type === "roll" ? (
              <div>
                <div style={styles.smallmuted}>Master: {h.master?.length ?? "—"} ft × {h.master?.width ?? "—"} in @ {fmtMoney(h.master?.cost ?? 0)}</div>
                {(h.cuts || []).map((c, j) => <div key={j} style={{ marginTop: 4 }}>▸ {c.label}: {c.lengthFt}ft × {c.widthIn}in = {fmtMoney(c.cost ?? 0)}{h.markup > 0 && <span style={{ color: COLORS.accent }}> → {fmtMoney(c.sell ?? 0)}</span>}</div>)}
                {h.remnant && <div style={{ marginTop: 4, color: COLORS.green }}>▸ Remnant: {fmtNum((h.remnant.sqIn ?? 0) / 144, 2)} sq ft = {fmtMoney(h.remnant.cost ?? 0)}</div>}
              </div>
            ) : h.type === "sheet" ? (
              <div>
                <div style={styles.smallmuted}>Sheet: {h.sheet?.lengthFt ?? "—"} ft × {h.sheet?.widthFt ?? "—"} ft @ {fmtMoney(h.sheet?.cost ?? 0)}</div>
                {(h.parts || []).map((p, j) => <div key={j} style={{ marginTop: 4 }}>▸ {p.label} ×{p.qty}: {fmtNum(p.perSqIn ?? 0, 2)} sq in ea = {fmtMoney(p.totalCost ?? 0)}{h.markup > 0 && <span style={{ color: COLORS.accent }}> → {fmtMoney(p.sell ?? 0)}</span>}</div>)}
                {h.remnant && <div style={{ marginTop: 4, color: COLORS.green }}>▸ Remnant: {fmtNum((h.remnant.sqIn ?? 0) / 144, 2)} sq ft = {fmtMoney(h.remnant.cost ?? 0)}</div>}
              </div>
            ) : h.type === "gasket" ? (
              <div>
                <div style={styles.smallmuted}>Sheet: {h.sheet?.lengthFt ?? "—"} ft × {h.sheet?.widthFt ?? "—"} ft @ {fmtMoney(h.sheet?.cost ?? 0)}</div>
                {(h.gaskets || []).map((g, j) => <div key={j} style={{ marginTop: 4 }}>▸ {g.label} ×{g.qty}: {g.gtype === "ff" ? "FF" : "RING"} {fmtNum(g.od ?? 0, 2)}"{g.gtype === "ring" ? ` × ${fmtNum(g.innerId ?? 0, 2)}"` : ""} = {fmtMoney(g.totalCost ?? 0)}{(g.saleTotal ?? 0) > 0 && <span style={{ color: COLORS.accent }}> → sale {fmtMoney(g.saleTotal)}</span>}</div>)}
                {h.outerRemnant && <div style={{ marginTop: 4, color: COLORS.green }}>▸ Outer remnant: {fmtNum((h.outerRemnant.sqIn ?? 0) / 144, 2)} sq ft = {fmtMoney(h.outerRemnant.cost ?? 0)}</div>}
                {h.innerRemnant && h.innerRemnant.sqIn > 0.001 && <div style={{ color: COLORS.green }}>▸ Inner discs: {fmtNum(h.innerRemnant.sqIn / 144, 2)} sq ft = {fmtMoney(h.innerRemnant.cost ?? 0)}</div>}
              </div>
            ) : <div style={styles.smallmuted}>(unknown entry type)</div>}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// APP — Main page with Supabase storage
// ============================================================
export default function MaterialCalculatorPage() {
  const [tab, setTab] = useState("roll");
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadedJob, setLoadedJob] = useState(null);
  const [loadCounter, setLoadCounter] = useState(0);
  const [editMode, setEditMode] = useState("new");
  const [editingId, setEditingId] = useState(null);
  const [lastSavedHash, setLastSavedHash] = useState(null);
  const [userId, setUserId] = useState(null);
  const skipNextSave = useRef(true);

  // Load history from Supabase on mount
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) setUserId(user.id);

        const { data, error } = await supabase
          .from('calculator_history')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (data && !error) {
          setHistory(data.map(row => ({
            ...row.data,
            id: row.id,
            jobName: row.job_name,
            type: row.type,
            when: row.created_at,
            editedAt: row.edited_at,
          })));
        }
      } catch (e) {
        console.error('Failed to load history:', e);
      }
      setLoaded(true);
    })();
  }, []);

  const hashCalc = (calc) => {
    const stable = {
      type: calc.type, jobName: calc.jobName, master: calc.master, sheet: calc.sheet,
      cuts: calc.cuts?.map((c) => ({ label: c.label, lengthFt: c.lengthFt, widthIn: c.widthIn })),
      parts: calc.parts?.map((p) => ({ label: p.label, mode: p.mode, sqIn: p.sqIn, lengthIn: p.lengthIn, widthIn: p.widthIn })),
      gaskets: calc.gaskets?.map((g) => ({ label: g.label, gtype: g.gtype, od: g.od, innerId: g.innerId, qty: g.qty, minutes: g.minutes })),
      markup: calc.markup, pricing: calc.pricing,
    };
    return JSON.stringify(stable);
  };

  const saveCalc = (calc) => {
    const trimmedName = (calc.jobName || "").trim();
    if (!trimmedName) return { ok: false, reason: "no-name" };

    const nameCollision = history.some((h) => (h.jobName || "").trim().toLowerCase() === trimmedName.toLowerCase() && h.id !== editingId);
    if (nameCollision) return { ok: false, reason: "name-taken" };

    const hash = hashCalc(calc);
    if (hash === lastSavedHash) return { ok: false, reason: "duplicate" };

    if (editMode === "edit" && editingId) {
      // Update existing record in Supabase
      const { id, when, editedAt, ...calcData } = calc;
      supabase.from('calculator_history').update({
        job_name: trimmedName,
        type: calc.type,
        data: calcData,
        edited_at: new Date().toISOString(),
      }).eq('id', editingId).then();

      setHistory((prev) => prev.map((h) => h.id === editingId ? { ...calc, id: editingId, when: h.when, editedAt: new Date().toISOString() } : h));
      setLastSavedHash(hash);
      return { ok: true, mode: "updated" };
    } else {
      // Insert new record into Supabase
      const newId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { id, when, editedAt, ...calcData } = calc;
      supabase.from('calculator_history').insert({
        id: newId,
        user_id: userId,
        job_name: trimmedName,
        type: calc.type,
        data: calcData,
        created_at: new Date().toISOString(),
      }).then();

      const newRecord = { ...calc, id: newId, when: new Date().toISOString() };
      setHistory((prev) => [newRecord, ...prev].slice(0, 50));
      setLastSavedHash(hash);
      setEditMode("edit");
      setEditingId(newId);
      return { ok: true, mode: "created" };
    }
  };

  const deleteItem = async (id) => {
    await supabase.from('calculator_history').delete().eq('id', id);
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const clearAll = async () => {
    // Delete all records for this user
    if (userId) {
      await supabase.from('calculator_history').delete().eq('user_id', userId);
    }
    setHistory([]);
    setLastSavedHash(null);
    setEditMode("new");
    setEditingId(null);
  };

  const openRecord = (record, mode) => {
    const targetTab = record.type === "roll" ? "roll" : record.type === "sheet" ? "sheet" : "gasket";
    if (mode === "duplicate") {
      const { id, when, editedAt, jobName, ...rest } = record;
      setLoadedJob({ ...rest, jobName: "" });
      setEditMode("new");
      setEditingId(null);
      setLastSavedHash(null);
    } else {
      setLoadedJob(record);
      setEditMode(mode);
      setEditingId(record.id);
      setLastSavedHash(hashCalc(record));
    }
    setLoadCounter((c) => c + 1);
    setTab(targetTab);
  };

  const startNewRecord = () => {
    setLoadedJob(null);
    setEditMode("new");
    setEditingId(null);
    setLastSavedHash(null);
    setLoadCounter((c) => c + 1);
  };

  return (
    <div style={styles.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        input:focus, select:focus {
          border-color: ${COLORS.accent} !important;
          box-shadow: 0 0 0 3px ${COLORS.accentSoft} !important;
        }
        button:hover { opacity: 0.92; }
        button:active { transform: translateY(1px); }
      `}</style>
      <div style={styles.shell}>
        <div style={styles.header}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: COLORS.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 16 }}>⊞</div>
              <h1 style={styles.title}>Material Calculator</h1>
            </div>
            <div style={styles.sub}>Rolls · Sheets · Slitting · Gaskets</div>
          </div>
          <div style={styles.version}>Shop Tools · v1.0</div>
        </div>

        <div style={styles.tabs}>
          <button style={styles.tab(tab === "roll")} onClick={() => setTab("roll")}>▸ Roll / Slitting</button>
          <button style={styles.tab(tab === "sheet")} onClick={() => setTab("sheet")}>▸ Sheet / Parts</button>
          <button style={styles.tab(tab === "gasket")} onClick={() => setTab("gasket")}>▸ Ring / FF Gaskets</button>
          <button style={styles.tab(tab === "history")} onClick={() => setTab("history")}>▸ History</button>
        </div>

        {tab === "roll" && <RollMode onSave={saveCalc} loadedJob={loadedJob} loadCounter={loadCounter} editMode={editMode} onNew={startNewRecord} onSwitchToEdit={() => setEditMode("edit")} />}
        {tab === "sheet" && <SheetMode onSave={saveCalc} loadedJob={loadedJob} loadCounter={loadCounter} editMode={editMode} onNew={startNewRecord} onSwitchToEdit={() => setEditMode("edit")} />}
        {tab === "gasket" && <GasketMode onSave={saveCalc} loadedJob={loadedJob} loadCounter={loadCounter} editMode={editMode} onNew={startNewRecord} onSwitchToEdit={() => setEditMode("edit")} />}
        {tab === "history" && <History items={history} onClear={clearAll} onDelete={deleteItem} onView={(r) => openRecord(r, "view")} onEdit={(r) => openRecord(r, "edit")} onDuplicate={(r) => openRecord(r, "duplicate")} />}
      </div>
    </div>
  );
}
