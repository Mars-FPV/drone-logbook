// Parser for EdgeTX telemetry CSV logs (radio SD card /LOGS/<Model>-YYYY-MM-DD.csv).
// A daily log can hold several flights: a gap of more than GAP_MS between
// consecutive rows starts a new flight, and segments shorter than
// MIN_FLIGHT_MS are treated as bench blips and dropped.

const GAP_MS = 90 * 1000;
const MIN_FLIGHT_MS = 20 * 1000;

export function parseEdgeTxLog(filename, text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const iDate = col("Date");
  const iTime = col("Time");
  if (iDate === -1 || iTime === -1) return [];

  const iAlt = [col("Alt(m)"), col("GAlt(m)"), col("Alt(ft)")].find((i) => i !== -1) ?? -1;
  const altInFeet = iAlt !== -1 && header[iAlt] === "Alt(ft)";
  const iGps = col("GPS");
  const iCapa = col("Capa(mAh)");

  const rows = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = lines[n].split(",");
    const ts = Date.parse(`${cells[iDate]}T${cells[iTime]}`);
    if (Number.isNaN(ts)) continue;
    rows.push({ ts, cells });
  }
  if (rows.length === 0) return [];

  const segments = [];
  let current = [rows[0]];
  for (let n = 1; n < rows.length; n++) {
    if (rows[n].ts - rows[n - 1].ts > GAP_MS) {
      segments.push(current);
      current = [];
    }
    current.push(rows[n]);
  }
  segments.push(current);

  const model = filename.replace(/\.csv$/i, "").replace(/-\d{4}-\d{2}-\d{2}(-\d{6})?$/, "");

  const entries = [];
  for (const seg of segments) {
    const startTs = seg[0].ts;
    const endTs = seg[seg.length - 1].ts;
    if (endTs - startTs < MIN_FLIGHT_MS) continue;

    let maxAlt = null;
    let coords = "";
    let capacityUsed = null;
    for (const { cells } of seg) {
      if (iAlt !== -1) {
        const a = parseFloat(cells[iAlt]);
        if (!Number.isNaN(a)) maxAlt = maxAlt === null ? a : Math.max(maxAlt, a);
      }
      if (!coords && iGps !== -1 && cells[iGps]) {
        const [lat, lon] = cells[iGps].trim().split(/\s+/).map(Number);
        if (lat && lon) coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      }
      if (iCapa !== -1) {
        const c = parseFloat(cells[iCapa]);
        if (!Number.isNaN(c)) capacityUsed = c;
      }
    }
    if (maxAlt !== null && altInFeet) maxAlt = maxAlt * 0.3048;

    const start = new Date(startTs);
    const end = new Date(endTs);
    const pad = (v) => String(v).padStart(2, "0");
    const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    entries.push({
      sourceId: `edgetx:${filename}:${start.toISOString()}`,
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      takeoffTime: hhmm(start),
      landingTime: hhmm(end),
      flightDuration: Math.max(1, Math.round((endTs - startTs) / 60000)).toString(),
      maxAltitude: maxAlt !== null ? `${Math.round(maxAlt)}m` : "",
      coords,
      location: coords || "Unknown site",
      craftName: model,
      craftType: "Multirotor",
      missionType: "Training / Practice",
      batteryUsed: capacityUsed !== null ? `${Math.round(capacityUsed)} mAh used` : "",
      notes: `Imported from EdgeTX log ${filename}`,
    });
  }
  return entries;
}
