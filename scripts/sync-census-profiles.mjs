import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const AGE_ZIP = "https://www.nomisweb.co.uk/output/census/2021/census2021-ts007-extra.zip";
const TENURE_ZIP = "https://www.nomisweb.co.uk/output/census/2021/census2021-ts054-extra.zip";
const OUTPUT = path.resolve("data/ward-profiles.generated.json");

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "user-agent": "London-Rental-Fit/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} · ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function normalise(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function numeric(value) {
  const result = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(result) ? result : null;
}

function findGeographyColumn(headers, rows) {
  const explicit = headers.findIndex((header) => /geography.*code|geography_code|ward.*code/.test(normalise(header)));
  if (explicit >= 0) return explicit;
  const sample = rows.slice(0, 20);
  for (let column = 0; column < headers.length; column += 1) {
    if (sample.some((row) => /^E05\d{6}$/.test(String(row[column] || "").trim()))) return column;
  }
  return -1;
}

function findColumn(headers, rules) {
  return headers.findIndex((header) => {
    const value = normalise(header);
    return rules.every((rule) => rule instanceof RegExp ? rule.test(value) : value.includes(rule));
  });
}

function findAggregateColumn(headers, include, exclude = []) {
  return headers.findIndex((header) => {
    const value = normalise(header);
    return include.every((needle) => value.includes(needle)) && exclude.every((needle) => !value.includes(needle));
  });
}

async function extractCsvTexts(zipPath) {
  const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], { maxBuffer: 10 * 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).filter((name) => /\.csv$/i.test(name));
  const texts = [];
  for (const entry of entries) {
    const result = await execFileAsync("unzip", ["-p", zipPath, entry], { maxBuffer: 100 * 1024 * 1024, encoding: "buffer" });
    texts.push(Buffer.from(result.stdout).toString("utf8"));
  }
  return texts;
}

function parseAgeCsv(text, output) {
  const rows = parseCsv(text);
  if (rows.length < 2) return;
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const geographyColumn = findGeographyColumn(headers, dataRows);
  if (geographyColumn < 0) return;

  const totalColumn = headers.findIndex((header) => {
    const value = normalise(header);
    return value.includes("total") && (value.includes("usual residents") || value.includes("all persons"));
  });
  const bandColumns = [
    findColumn(headers, [/aged 20 to 24 years/]),
    findColumn(headers, [/aged 25 to 29 years/]),
    findColumn(headers, [/aged 30 to 34 years/]),
    findColumn(headers, [/aged 35 to 39 years/]),
  ];
  if (totalColumn < 0 || bandColumns.some((index) => index < 0)) return;

  for (const row of dataRows) {
    const code = String(row[geographyColumn] || "").trim();
    if (!/^E05\d{6}$/.test(code)) continue;
    const total = numeric(row[totalColumn]);
    const bands = bandColumns.map((column) => numeric(row[column]));
    if (!total || bands.some((value) => value === null)) continue;
    const age20to39 = bands.reduce((sum, value) => sum + Number(value), 0);
    output[code] ||= {};
    output[code].age20to39Pct = Math.round((age20to39 / total) * 100);
    output[code].population = Math.round(total);
  }
}

function parseTenureCsv(text, output) {
  const rows = parseCsv(text);
  if (rows.length < 2) return;
  const headers = rows[0];
  const dataRows = rows.slice(1);
  const geographyColumn = findGeographyColumn(headers, dataRows);
  if (geographyColumn < 0) return;

  const totalColumn = headers.findIndex((header) => {
    const value = normalise(header);
    return value.includes("total") && value.includes("all households");
  });
  let privateColumn = findAggregateColumn(headers, ["private rented"], ["landlord", "letting agency", "other private", "rent free"]);
  if (privateColumn < 0) {
    privateColumn = headers.findIndex((header) => normalise(header).endsWith("private rented"));
  }
  if (totalColumn < 0 || privateColumn < 0) return;

  for (const row of dataRows) {
    const code = String(row[geographyColumn] || "").trim();
    if (!/^E05\d{6}$/.test(code)) continue;
    const total = numeric(row[totalColumn]);
    const privateRented = numeric(row[privateColumn]);
    if (!total || privateRented === null) continue;
    output[code] ||= {};
    output[code].privateRentPct = Math.round((privateRented / total) * 100);
    output[code].households = Math.round(total);
  }
}

function makeProfile(values) {
  const facts = [];
  const tags = [];
  if (Number.isFinite(values.age20to39Pct)) {
    facts.push(`${values.age20to39Pct}% of residents were aged 20–39`);
    tags.push(`Age 20–39 · ${values.age20to39Pct}%`);
  }
  if (Number.isFinite(values.privateRentPct)) {
    facts.push(`${values.privateRentPct}% of households were privately rented`);
    tags.push(`Private renting · ${values.privateRentPct}%`);
  }
  if (!facts.length) return null;

  const summary = `Census 2021 shows ${facts.join(" and ")}. These figures describe the official ward’s resident and housing mix and are included as context alongside current rent, commute and reported-crime constraints.`;
  return {
    summary,
    tags,
    facts: {
      age20to39Pct: values.age20to39Pct ?? null,
      privateRentPct: values.privateRentPct ?? null,
      population: values.population ?? null,
      households: values.households ?? null,
    },
    source: "ONS Census 2021 via Nomis · 2022 ward geography",
  };
}

async function main() {
  const temp = await mkdtemp(path.join(tmpdir(), "london-census-"));
  try {
    const agePath = path.join(temp, "age.zip");
    const tenurePath = path.join(temp, "tenure.zip");
    const [ageZip, tenureZip] = await Promise.all([fetchBuffer(AGE_ZIP), fetchBuffer(TENURE_ZIP)]);
    await Promise.all([writeFile(agePath, ageZip), writeFile(tenurePath, tenureZip)]);

    const raw = {};
    const [ageTexts, tenureTexts] = await Promise.all([extractCsvTexts(agePath), extractCsvTexts(tenurePath)]);
    ageTexts.forEach((text) => parseAgeCsv(text, raw));
    tenureTexts.forEach((text) => parseTenureCsv(text, raw));

    const profiles = Object.fromEntries(
      Object.entries(raw)
        .map(([code, values]) => [code, makeProfile(values)])
        .filter(([, profile]) => Boolean(profile)),
    );

    if (Object.keys(profiles).length < 500) {
      throw new Error(`Only ${Object.keys(profiles).length} ward profiles parsed; refusing to publish incomplete Census profiles.`);
    }

    await mkdir(path.dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), profiles }, null, 2)}\n`, "utf8");
    console.log(`Wrote ${Object.keys(profiles).length} Census-based ward profiles to ${OUTPUT}`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
