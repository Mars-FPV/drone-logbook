import { useState, useEffect, useRef } from "react";
import {
  getAllEntries,
  putEntry,
  deleteEntryById,
  mergeEntries,
  migrateFromLocalStorage,
  newId,
} from "./db";
import { parseEdgeTxLog } from "./edgetx";
import { parseBlackboxCsv, isBlackboxHeader } from "./blackbox";

const emptyEntry = {
  date: "",
  pilotName: "",
  flierID: "",
  operatorID: "",
  craftName: "",
  craftType: "",
  serialNumber: "",
  location: "",
  coords: "",
  airspaceClass: "",
  operationCategory: "",
  missionType: "",
  weatherConditions: "",
  windSpeed: "",
  visibility: "",
  takeoffTime: "",
  landingTime: "",
  flightDuration: "",
  batteryUsed: "",
  maxAltitude: "",
  incidents: "",
  preFlightCheck: false,
  notes: "",
};

const missionTypes = ["Training / Practice", "Mapping / Survey", "Agriculture", "Search & Rescue", "Inspection", "Photography / Video", "BVLOS Test", "Other"];
const craftTypes = ["Multirotor", "Fixed Wing", "VTOL"];
const categories = ["Open A1", "Open A2", "Open A3", "Specific - PDRA01", "Specific - UK SORA", "BVLOS - ARC-a"];
const airspaceClasses = ["Uncontrolled (G)", "Controlled (A-F)", "ATZ", "FRZ", "AAE"];

export default function DroneFlightLog() {
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("log"); // log | add | detail | data
  const [form, setForm] = useState(emptyEntry);
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState(null); // { text, tone: "ok" | "warn" }
  const [totalHours, setTotalHours] = useState(0);
  const [fixDate, setFixDate] = useState("");
  const noticeTimer = useRef(null);
  const restoreInputRef = useRef(null);
  const radioInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const migrated = await migrateFromLocalStorage();
        setEntries(await getAllEntries());
        if (migrated > 0) showNotice(`✓ Migrated ${migrated} entries from previous storage`);
      } catch {
        showNotice("Could not open the local database", "warn");
      }
    })();
  }, []);

  useEffect(() => {
    const mins = entries.reduce((acc, e) => acc + (parseFloat(e.flightDuration) || 0), 0);
    setTotalHours((mins / 60).toFixed(1));
  }, [entries]);

  function showNotice(text, tone = "ok") {
    clearTimeout(noticeTimer.current);
    setNotice({ text, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  function calcDuration() {
    if (form.takeoffTime && form.landingTime) {
      const [th, tm] = form.takeoffTime.split(":").map(Number);
      const [lh, lm] = form.landingTime.split(":").map(Number);
      const diff = (lh * 60 + lm) - (th * 60 + tm);
      if (diff > 0) setForm(f => ({ ...f, flightDuration: diff.toString() }));
    }
  }

  async function handleSubmit() {
    if (!form.date || !form.location || !form.craftName) return;
    await putEntry({ ...form, id: newId() });
    setEntries(await getAllEntries());
    setForm(emptyEntry);
    showNotice("✓ Flight logged successfully");
    setView("log");
  }

  async function deleteEntry(id) {
    await deleteEntryById(id);
    setEntries(await getAllEntries());
    setSelected(null);
    setView("log");
  }

  async function saveFlightDate() {
    if (!fixDate || !selected) return;
    const updated = { ...selected, date: fixDate };
    await putEntry(updated);
    setEntries(await getAllEntries());
    setSelected(updated);
    setFixDate("");
    showNotice("✓ Flight date saved");
  }

  function handleExport() {
    const payload = { app: "drone-flight-logbook", exportedAt: new Date().toISOString(), entries };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flight-log-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleRestore(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed?.entries;
      if (!Array.isArray(incoming)) throw new Error("not a backup file");
      const { added, skipped } = await mergeEntries(
        incoming.map(en => ({ ...emptyEntry, ...en, id: en.id || newId() }))
      );
      setEntries(await getAllEntries());
      showNotice(`✓ Restored ${added} entries (${skipped} duplicates skipped)`);
    } catch {
      showNotice("Restore failed — not a valid backup file", "warn");
    }
  }

  async function handleRadioImport(e) {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    if (files.length === 0) return;
    const drafts = [];
    for (const file of files) {
      if (/\.gps\.csv$/i.test(file.name)) continue; // side output of blackbox_decode
      try {
        const headerLine = (await file.slice(0, 8192).text()).split("\n")[0];
        if (isBlackboxHeader(headerLine)) {
          const entry = await parseBlackboxCsv(file);
          if (entry) drafts.push(entry);
        } else {
          drafts.push(...parseEdgeTxLog(file.name, await file.text()));
        }
      } catch {
        // unreadable file — reported below if nothing parses
      }
    }
    if (drafts.length === 0) {
      showNotice("No flights found — expected EdgeTX telemetry or decoded blackbox CSVs", "warn");
      return;
    }
    const { added, skipped } = await mergeEntries(
      drafts.map(d => ({ ...emptyEntry, ...d, id: newId() }))
    );
    setEntries(await getAllEntries());
    showNotice(`✓ Imported ${added} flights from radio (${skipped} already logged)`);
  }

  const flightsByMonth = entries.reduce((acc, e) => {
    const month = e.date?.slice(0, 7) || "Unknown";
    acc[month] = (acc[month] || 0) + (parseFloat(e.flightDuration) || 0);
    return acc;
  }, {});

  const recentCurrency = () => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recent = entries.filter(e => new Date(e.date) >= threeMonthsAgo);
    const mins = recent.reduce((acc, e) => acc + (parseFloat(e.flightDuration) || 0), 0);
    return (mins / 60).toFixed(1);
  };

  return (
    <div style={{ fontFamily: "'Courier New', monospace", minHeight: "100vh", background: "#0a0a0a", color: "#e8e0d0" }}>
      {/* Header */}
      <div style={{ background: "#111", borderBottom: "2px solid #c8a84b", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: "#c8a84b", textTransform: "uppercase" }}>Remote Pilot</div>
          <div style={{ fontSize: 22, fontWeight: "bold", letterSpacing: 2, color: "#fff" }}>Flight Logbook</div>
          <div style={{ fontSize: 10, color: "#888", letterSpacing: 2 }}>CAA RPC-L2 COMPLIANT · UK SORA</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#888" }}>Total Hours</div>
          <div style={{ fontSize: 32, color: "#c8a84b", fontWeight: "bold" }}>{totalHours}</div>
          <div style={{ fontSize: 10, color: "#888" }}>hrs logged</div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #222" }}>
        {["log", "add", "data"].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            flex: 1, padding: "10px", background: view === v ? "#1a1a1a" : "transparent",
            border: "none", borderBottom: view === v ? "2px solid #c8a84b" : "2px solid transparent",
            color: view === v ? "#c8a84b" : "#666", cursor: "pointer", fontSize: 11,
            letterSpacing: 3, textTransform: "uppercase"
          }}>
            {v === "log" ? `📋 Log (${entries.length})` : v === "add" ? "✚ New Entry" : "💾 Data"}
          </button>
        ))}
      </div>

      {/* Stats Bar */}
      {view === "log" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#222", margin: "0 0 1px 0" }}>
          {[
            { label: "Total Flights", value: entries.length },
            { label: "Hours (3 months)", value: `${recentCurrency()} hrs` },
            { label: "Hours to RPC-L2", value: `${Math.max(0, 50 - parseFloat(totalHours)).toFixed(1)} remaining` },
          ].map(s => (
            <div key={s.label} style={{ background: "#111", padding: "10px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 18, color: parseFloat(recentCurrency()) >= 2 || s.label === "Total Flights" ? "#4caf74" : "#c8a84b", fontWeight: "bold" }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "#666", letterSpacing: 2, textTransform: "uppercase" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Currency Warning */}
      {view === "log" && parseFloat(recentCurrency()) < 2 && entries.length > 0 && (
        <div style={{ background: "#2a1a00", borderLeft: "3px solid #ff9800", padding: "8px 16px", fontSize: 11, color: "#ff9800" }}>
          ⚠️ CURRENCY WARNING: Less than 2 hours logged in the last 3 months. CAA requires 2 hrs minimum currency for Specific Category ops.
        </div>
      )}

      {/* Notice banner */}
      {notice && (
        <div style={{
          background: notice.tone === "warn" ? "#2a1a00" : "#0a2a0a",
          borderLeft: `3px solid ${notice.tone === "warn" ? "#ff9800" : "#4caf74"}`,
          padding: "8px 16px", fontSize: 11,
          color: notice.tone === "warn" ? "#ff9800" : "#4caf74"
        }}>
          {notice.tone === "warn" ? "⚠ " : ""}{notice.text}
        </div>
      )}

      {/* LOG VIEW */}
      {view === "log" && (
        <div style={{ padding: 16 }}>
          {entries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#444" }}>
              <div style={{ fontSize: 40 }}>📓</div>
              <div style={{ fontSize: 14, marginTop: 12 }}>No flights logged yet</div>
              <div style={{ fontSize: 11, marginTop: 6, color: "#333" }}>Tap "New Entry" to log your first flight</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {entries.map(e => (
                <div key={e.id} onClick={() => { setSelected(e); setFixDate(""); setView("detail"); }}
                  style={{ background: "#111", border: "1px solid #1e1e1e", borderLeft: "3px solid #c8a84b", padding: "12px 14px", cursor: "pointer", borderRadius: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 13, color: "#fff", fontWeight: "bold" }}>{e.location}</div>
                      <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{e.date} · {e.craftName} · {e.missionType}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 16, color: "#c8a84b", fontWeight: "bold" }}>{e.flightDuration}m</div>
                      <div style={{ fontSize: 9, color: "#555" }}>{(e.flightDuration / 60).toFixed(2)} hrs</div>
                    </div>
                  </div>
                  {e.incidents && <div style={{ marginTop: 6, fontSize: 10, color: "#e55", background: "#200", padding: "3px 6px" }}>⚠ {e.incidents}</div>}
                  {!e.date && <div style={{ marginTop: 6, fontSize: 10, color: "#ff9800", background: "#2a1a00", padding: "3px 6px" }}>📅 DATE NEEDED — open this entry to set it</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 16 }}>
          <button onClick={() => setView("log")} style={{ background: "none", border: "none", color: "#c8a84b", cursor: "pointer", fontSize: 11, letterSpacing: 2, marginBottom: 16 }}>
            ← BACK TO LOG
          </button>
          <div style={{ background: "#111", border: "1px solid #222", padding: 16, borderRadius: 2 }}>
            <div style={{ fontSize: 16, color: "#fff", fontWeight: "bold", marginBottom: 4 }}>{selected.location}</div>
            <div style={{ fontSize: 10, color: "#c8a84b", letterSpacing: 2, marginBottom: 16 }}>{selected.date || "— DATE NOT SET —"}</div>
            {!selected.date && (
              <div style={{ background: "#2a1a00", border: "1px solid #ff980055", padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: "#ff9800", letterSpacing: 1, marginBottom: 8 }}>
                  📅 FLIGHT DATE NEEDED — blackbox logs don't record the calendar date
                </div>
                <input type="date" value={fixDate} onChange={e => setFixDate(e.target.value)} style={{
                  width: "100%", background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 2,
                  color: "#e8e0d0", padding: "8px 10px", fontSize: 12, fontFamily: "'Courier New', monospace",
                  boxSizing: "border-box"
                }} />
                <button onClick={saveFlightDate} disabled={!fixDate} style={{
                  marginTop: 8, width: "100%", padding: "10px", background: fixDate ? "#c8a84b" : "#333",
                  border: "none", color: fixDate ? "#000" : "#666", fontWeight: "bold", fontSize: 11,
                  letterSpacing: 2, cursor: fixDate ? "pointer" : "default"
                }}>
                  SAVE DATE
                </button>
              </div>
            )}
            {[
              ["Pilot", selected.pilotName], ["Flyer ID", selected.flierID], ["Operator ID", selected.operatorID],
              ["Aircraft", selected.craftName], ["Type", selected.craftType], ["Serial No.", selected.serialNumber],
              ["GPS Coords", selected.coords], ["Airspace", selected.airspaceClass], ["Category", selected.operationCategory],
              ["Mission", selected.missionType], ["Weather", selected.weatherConditions], ["Wind", selected.windSpeed],
              ["Visibility", selected.visibility], ["Takeoff", selected.takeoffTime], ["Landing", selected.landingTime],
              ["Duration", `${selected.flightDuration} minutes (${(selected.flightDuration / 60).toFixed(2)} hrs)`],
              ["Battery", selected.batteryUsed], ["Max Altitude", selected.maxAltitude],
              ["Pre-Flight Check", selected.preFlightCheck ? "✓ Completed" : "✗ Not recorded"],
              ["Incidents / Anomalies", selected.incidents || "None"], ["Notes", selected.notes || "—"],
            ].map(([label, val]) => val && (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a1a1a", fontSize: 11 }}>
                <span style={{ color: "#666", letterSpacing: 1 }}>{label.toUpperCase()}</span>
                <span style={{ color: "#e8e0d0", textAlign: "right", maxWidth: "60%" }}>{val}</span>
              </div>
            ))}
          </div>
          <button onClick={() => deleteEntry(selected.id)} style={{
            marginTop: 16, width: "100%", padding: "10px", background: "transparent",
            border: "1px solid #3a1a1a", color: "#e55", cursor: "pointer", fontSize: 11, letterSpacing: 2
          }}>
            DELETE ENTRY
          </button>
        </div>
      )}

      {/* ADD ENTRY VIEW */}
      {view === "add" && (
        <div style={{ padding: 16 }}>
          <Section title="Pilot Details">
            <Field label="Full Name" name="pilotName" value={form.pilotName} onChange={handleChange} />
            <Field label="Flyer ID" name="flierID" value={form.flierID} onChange={handleChange} placeholder="FLY-XXXXXXXX" />
            <Field label="Operator ID" name="operatorID" value={form.operatorID} onChange={handleChange} placeholder="OPR-XXXXXXXX" />
          </Section>

          <Section title="Aircraft">
            <Field label="Craft Name / Call" name="craftName" value={form.craftName} onChange={handleChange} placeholder="e.g. Red Scorp" />
            <SelectField label="Type" name="craftType" value={form.craftType} onChange={handleChange} options={craftTypes} />
            <Field label="Serial Number" name="serialNumber" value={form.serialNumber} onChange={handleChange} />
          </Section>

          <Section title="Flight Details">
            <Field label="Date *" name="date" type="date" value={form.date} onChange={handleChange} />
            <Field label="Location / Site *" name="location" value={form.location} onChange={handleChange} placeholder="e.g. North Farm, Yorkshire" />
            <Field label="GPS Coordinates" name="coords" value={form.coords} onChange={handleChange} placeholder="e.g. 53.8°N, 1.5°W" />
            <SelectField label="Airspace Class" name="airspaceClass" value={form.airspaceClass} onChange={handleChange} options={airspaceClasses} />
            <SelectField label="Operation Category" name="operationCategory" value={form.operationCategory} onChange={handleChange} options={categories} />
            <SelectField label="Mission Type" name="missionType" value={form.missionType} onChange={handleChange} options={missionTypes} />
          </Section>

          <Section title="Weather">
            <Field label="Conditions" name="weatherConditions" value={form.weatherConditions} onChange={handleChange} placeholder="e.g. Clear, partly cloudy" />
            <Field label="Wind Speed (knots/mph)" name="windSpeed" value={form.windSpeed} onChange={handleChange} placeholder="e.g. 8 kts" />
            <Field label="Visibility" name="visibility" value={form.visibility} onChange={handleChange} placeholder="e.g. 5km+" />
          </Section>

          <Section title="Times & Duration">
            <Field label="Takeoff Time" name="takeoffTime" type="time" value={form.takeoffTime} onChange={e => { handleChange(e); }} onBlur={calcDuration} />
            <Field label="Landing Time" name="landingTime" type="time" value={form.landingTime} onChange={handleChange} onBlur={calcDuration} />
            <Field label="Flight Duration (mins) *" name="flightDuration" type="number" value={form.flightDuration} onChange={handleChange} placeholder="Auto-calculated or enter manually" />
            <Field label="Battery / Pack Used" name="batteryUsed" value={form.batteryUsed} onChange={handleChange} placeholder="e.g. 6S #2 — 4200mAh" />
            <Field label="Max Altitude (m AGL)" name="maxAltitude" value={form.maxAltitude} onChange={handleChange} placeholder="e.g. 85m" />
          </Section>

          <Section title="Safety & Compliance">
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid #1a1a1a" }}>
              <input type="checkbox" name="preFlightCheck" checked={form.preFlightCheck} onChange={handleChange}
                style={{ accentColor: "#c8a84b", width: 16, height: 16 }} />
              <label style={{ fontSize: 11, color: "#aaa", letterSpacing: 1 }}>PRE-FLIGHT CHECK COMPLETED</label>
            </div>
            <Field label="Incidents / Anomalies" name="incidents" value={form.incidents} onChange={handleChange} placeholder="None, or describe any issues" />
            <Field label="Notes" name="notes" value={form.notes} onChange={handleChange} placeholder="Mission notes, observations..." textarea />
          </Section>

          <button onClick={handleSubmit} style={{
            width: "100%", padding: "14px", background: "#c8a84b", border: "none",
            color: "#000", fontWeight: "bold", fontSize: 12, letterSpacing: 3,
            cursor: "pointer", marginTop: 8, textTransform: "uppercase"
          }}>
            LOG FLIGHT
          </button>
          <div style={{ fontSize: 9, color: "#444", textAlign: "center", marginTop: 8, letterSpacing: 1 }}>
            * Required fields · Data saved locally to this device
          </div>
        </div>
      )}

      {/* DATA VIEW */}
      {view === "data" && (
        <div style={{ padding: 16 }}>
          <Section title="Backup">
            <DataButton onClick={handleExport} label="⬆ Export Backup"
              hint="Download all entries as a timestamped JSON file" />
            <DataButton onClick={() => restoreInputRef.current?.click()} label="⬇ Restore Backup"
              hint="Import a backup JSON — entries merge without duplicating" />
            <input ref={restoreInputRef} type="file" accept=".json,application/json"
              onChange={handleRestore} style={{ display: "none" }} />
          </Section>

          <Section title="Import Flights">
            <DataButton onClick={() => radioInputRef.current?.click()} label="📻 Import Radio / Blackbox Logs"
              hint="EdgeTX telemetry CSVs (radio SD card, LOGS folder) or decoded Betaflight blackbox CSVs — format is detected automatically" />
            <input ref={radioInputRef} type="file" accept=".csv,text/csv" multiple
              onChange={handleRadioImport} style={{ display: "none" }} />
            <div style={{ fontSize: 10, color: "#555", marginTop: 8, lineHeight: 1.6 }}>
              EdgeTX logs are split into flights automatically (gaps over 90 seconds start a new
              flight) with date, times, duration, altitude, GPS and battery filled in.
              Betaflight blackbox logs (.bbl / .bfl) must first be converted to CSV with
              `npm run decode-blackbox` — those entries import with duration, max altitude,
              min voltage and GPS, but need the flight date set manually.
              Re-importing the same log won't create duplicates.
            </div>
          </Section>

          <div style={{ fontSize: 9, color: "#444", textAlign: "center", marginTop: 8, letterSpacing: 1 }}>
            All data is stored locally on this device (IndexedDB). Export a backup regularly.
          </div>
        </div>
      )}
    </div>
  );
}

function DataButton({ onClick, label, hint }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px solid #111" }}>
      <button onClick={onClick} style={{
        width: "100%", padding: "12px", background: "#111", border: "1px solid #c8a84b55",
        color: "#c8a84b", cursor: "pointer", fontSize: 11, letterSpacing: 2,
        textTransform: "uppercase", fontFamily: "'Courier New', monospace"
      }}>
        {label}
      </button>
      <div style={{ fontSize: 9, color: "#555", marginTop: 4, letterSpacing: 1 }}>{hint}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 9, letterSpacing: 3, color: "#c8a84b", textTransform: "uppercase", padding: "8px 0 4px", borderBottom: "1px solid #c8a84b33" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, name, value, onChange, type = "text", placeholder = "", textarea, onBlur }) {
  const style = {
    width: "100%", background: "#0a0a0a", border: "1px solid #1e1e1e", borderRadius: 2,
    color: "#e8e0d0", padding: "8px 10px", fontSize: 12, fontFamily: "'Courier New', monospace",
    boxSizing: "border-box", marginTop: 4
  };
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid #111" }}>
      <label style={{ fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{label}</label>
      {textarea
        ? <textarea name={name} value={value} onChange={onChange} placeholder={placeholder} rows={3} style={{ ...style, resize: "vertical" }} />
        : <input name={name} type={type} value={value} onChange={onChange} onBlur={onBlur} placeholder={placeholder} style={style} />
      }
    </div>
  );
}

function SelectField({ label, name, value, onChange, options }) {
  return (
    <div style={{ padding: "6px 0", borderBottom: "1px solid #111" }}>
      <label style={{ fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{label}</label>
      <select name={name} value={value} onChange={onChange} style={{
        width: "100%", background: "#0a0a0a", border: "1px solid #1e1e1e",
        color: "#e8e0d0", padding: "8px 10px", fontSize: 12, fontFamily: "'Courier New', monospace",
        boxSizing: "border-box", marginTop: 4, borderRadius: 2
      }}>
        <option value="">— Select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
