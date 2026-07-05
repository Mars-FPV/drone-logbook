// Parser for CSVs produced by blackbox_decode (see decode-blackbox.js).
// Files are streamed rather than loaded whole — a few minutes of 2 kHz
// logging is easily 100+ MB. Blackbox logs carry no wall-clock date, so
// entries are created with a blank date for the pilot to fill in.
//
// Units verified against real decoder output: baroAlt is centimetres
// (despite --unit-height m), GPS_altitude is 0.1 m steps (MSL).

const MIN_FLIGHT_US = 20 * 1e6;
const SAMPLE_EVERY = 20; // full column parse ~every 20th row (~100 Hz of a 2 kHz log)

async function* lineStream(file) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop();
    for (const line of parts) yield line;
  }
  buf += decoder.decode();
  if (buf) yield buf;
}

export function isBlackboxHeader(headerLine) {
  return headerLine.includes("time (us)") && headerLine.includes("loopIteration");
}

export async function parseBlackboxCsv(file) {
  let cols = null;
  let iTime = -1, iVbat = -1, iBaro = -1, iLat = -1, iLon = -1, iGAlt = -1;
  let firstT = null, lastT = null;
  let minVbat = Infinity;
  let maxBaroCm = null;
  let firstGpsAltRaw = null, maxGpsAltRaw = null;
  let coords = "";
  let lastLine = null;
  let n = 0;

  const sample = (line) => {
    const c = line.split(",");
    const t = Number(c[iTime]);
    if (!Number.isFinite(t)) return;
    if (firstT === null) firstT = t;
    lastT = t;
    if (iVbat !== -1) {
      const v = parseFloat(c[iVbat]);
      if (v > 0 && v < minVbat) minVbat = v;
    }
    if (iBaro !== -1) {
      const b = parseFloat(c[iBaro]);
      if (Number.isFinite(b)) maxBaroCm = maxBaroCm === null ? b : Math.max(maxBaroCm, b);
    }
    if (iGAlt !== -1) {
      const g = parseFloat(c[iGAlt]);
      if (Number.isFinite(g) && g !== 0) {
        if (firstGpsAltRaw === null) firstGpsAltRaw = g;
        maxGpsAltRaw = maxGpsAltRaw === null ? g : Math.max(maxGpsAltRaw, g);
      }
    }
    if (!coords && iLat !== -1) {
      const lat = parseFloat(c[iLat]);
      const lon = parseFloat(c[iLon]);
      if (lat && lon) coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  };

  for await (const raw of lineStream(file)) {
    const line = raw.trim();
    if (!line) continue;
    if (!cols) {
      cols = line.split(",").map((h) => h.trim());
      iTime = cols.indexOf("time (us)");
      iVbat = cols.findIndex((h) => h.startsWith("vbatLatest"));
      iBaro = cols.findIndex((h) => h.startsWith("baroAlt"));
      iLat = cols.indexOf("GPS_coord[0]");
      iLon = cols.indexOf("GPS_coord[1]");
      iGAlt = cols.indexOf("GPS_altitude");
      if (iTime === -1) return null;
      continue;
    }
    // Only every Nth row gets a full parse; the final row is handled after
    // the loop so the duration end point is exact.
    if (n % SAMPLE_EVERY === 0) sample(line);
    lastLine = line;
    n++;
  }
  if (lastLine) sample(lastLine);

  if (firstT === null || lastT - firstT < MIN_FLIGHT_US) return null;

  // GPS-only fragments (e.g. a home-point log with a single loop frame) can
  // span minutes but have almost no rows. Real flight logs run at hundreds
  // of rows per second; anything under 50 Hz isn't a flight.
  const rowsPerSecond = n / ((lastT - firstT) / 1e6);
  if (rowsPerSecond < 50) return null;

  let maxAltM = null;
  if (maxBaroCm !== null) {
    maxAltM = maxBaroCm / 100;
  } else if (maxGpsAltRaw !== null && firstGpsAltRaw !== null) {
    maxAltM = (maxGpsAltRaw - firstGpsAltRaw) / 10;
  }

  const stem = file.name.replace(/\.csv$/i, "").replace(/\.\d{2}$/, "");
  return {
    sourceId: `blackbox:${file.name}`,
    date: "", // blackbox logs have no wall-clock date — pilot fills this in
    takeoffTime: "",
    landingTime: "",
    flightDuration: Math.max(1, Math.round((lastT - firstT) / 60e6)).toString(),
    maxAltitude: maxAltM !== null ? `${Math.round(maxAltM)}m` : "",
    coords,
    location: coords || "Unknown site",
    craftName: stem,
    craftType: "Multirotor",
    missionType: "Training / Practice",
    batteryUsed: Number.isFinite(minVbat) && minVbat !== Infinity ? `min ${minVbat.toFixed(2)} V` : "",
    notes: `Imported from Betaflight blackbox log ${file.name}`,
  };
}
