#!/usr/bin/env node
// Decodes Betaflight blackbox logs (.bbl / .bfl) in blackbox-logs/ into CSVs
// that the app's Import Flights button understands.
//
//   Usage: npm run decode-blackbox        (add --force to re-decode)
//
// blackbox_decode is downloaded on first run from the blackbox-tools v0.4.3
// GitHub release. The betaflight/blackbox-tools fork publishes no binaries,
// so the download comes from the upstream cleanflight/blackbox-tools release
// (same tool — Betaflight's fork is source-only).

import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const TOOLS = join(ROOT, "tools");
const LOGS = join(ROOT, "blackbox-logs");
const EXE = join(TOOLS, process.platform === "win32" ? "blackbox_decode.exe" : "blackbox_decode");
const ZIP_URL =
  "https://github.com/cleanflight/blackbox-tools/releases/download/v0.4.3/blackbox-tools-0.4.3-windows.zip";

function findFile(dir, pattern) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const found = findFile(full, pattern);
      if (found) return found;
    } else if (pattern.test(name)) {
      return full;
    }
  }
  return null;
}

async function ensureDecoder() {
  if (existsSync(EXE)) return;
  if (process.platform !== "win32") {
    console.error(
      `No auto-download for ${process.platform}. Build blackbox_decode from ` +
        `https://github.com/betaflight/blackbox-tools and place it at ${EXE}`
    );
    process.exit(1);
  }
  console.log("Downloading blackbox_decode (blackbox-tools v0.4.3)...");
  mkdirSync(TOOLS, { recursive: true });
  const res = await fetch(ZIP_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const zipPath = join(TOOLS, "blackbox-tools.zip");
  await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));

  const extractDir = join(TOOLS, "_extract");
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  // Windows 10+ ships bsdtar, which extracts zip archives.
  execFileSync("tar", ["-xf", zipPath, "-C", extractDir]);

  const found = findFile(extractDir, /^blackbox_decode\.exe$/i);
  if (!found) throw new Error("blackbox_decode.exe not found in the downloaded archive");
  for (const name of readdirSync(dirname(found))) {
    if (/\.(exe|dll)$/i.test(name)) copyFileSync(join(dirname(found), name), join(TOOLS, name));
  }
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  console.log("blackbox_decode ready in tools/");
}

async function main() {
  const force = process.argv.includes("--force");
  await ensureDecoder();

  if (!existsSync(LOGS)) {
    mkdirSync(LOGS, { recursive: true });
    console.log(`Created ${LOGS}`);
    console.log("Copy your .bbl / .bfl files in there and run this again.");
    return;
  }
  const logs = readdirSync(LOGS).filter((f) => /\.(bbl|bfl)$/i.test(f));
  if (logs.length === 0) {
    console.log(`No .bbl / .bfl files found in ${LOGS}`);
    return;
  }

  let decoded = 0;
  let skipped = 0;
  for (const name of logs) {
    const stem = name.replace(/\.(bbl|bfl)$/i, "");
    if (!force && readdirSync(LOGS).some((f) => f.startsWith(`${stem}.`) && f.endsWith(".csv"))) {
      console.log(`- ${name}: already decoded (use --force to redo)`);
      skipped++;
      continue;
    }
    console.log(`- decoding ${name}`);
    execFileSync(
      EXE,
      ["--merge-gps", "--unit-height", "m", "--unit-vbat", "V", join(LOGS, name)],
      { stdio: "inherit" }
    );
    decoded++;
  }

  const csvs = readdirSync(LOGS).filter((f) => f.endsWith(".csv") && !/\.gps\.csv$/i.test(f));
  console.log(`\nDone: ${decoded} decoded, ${skipped} skipped, ${csvs.length} CSV(s) in blackbox-logs/`);
  console.log("Import them via the app's Data tab (each CSV is one flight; a log");
  console.log("file with several arm/disarm sessions produces .01, .02, ... CSVs).");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
