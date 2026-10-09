import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=la_name%2Cla_gss_code&returnGeometry=false&f=json";
const OUTPUT = path.resolve("data/ons-rents-by-borough.json");

const LONDON_BOROUGHS = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London",
  "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith and Fulham", "Haringey",
  "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames", "Southwark", "Sutton",
  "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
];

function normalise(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^royal borough of /, "")
    .replace(/^london borough of /, "")
    .replace(/^city of westminster$/, "westminster")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const canonicalByName = new Map(LONDON_BOROUGHS.map((name) => [normalise(name), name]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "LondonRentalFit/1.0" } });
      if (response.ok) return response;
      if (response.status === 429 || response.status >= 500) {
        await sleep(attempt * 1200);
        continue;
      }
      throw new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1000);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

function htmlToText(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&pound;|&#163;|&#xA3;/gi, "£")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function moneyAfter(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*:?\\s*£\\s*([0-9][0-9,]*)`, "i"));
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseBedroomRents(html) {
  const text = htmlToText(html);
  const rents = {
    "1": moneyAfter(text, "One bedroom"),
    "2": moneyAfter(text, "Two bedrooms"),
    "3": moneyAfter(text, "Three bedrooms"),
    "4+": moneyAfter(text, "Four or more bedrooms"),
  };
  const entries = Object.entries(rents).filter(([, value]) => Number.isFinite(value));
  return Object.fromEntries(entries);
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

async function main() {
  const response = await fetchWithRetry(GLA_WARDS);
  const payload = await response.json();
  const byBorough = new Map();

  for (const feature of payload.features || []) {
    const properties = feature.attributes || feature.properties || {};
    const rawName = properties.la_name || properties.LA_NAME;
    const code = String(properties.la_gss_code || properties.LA_GSS_CODE || "").trim();
    const canonical = canonicalByName.get(normalise(rawName));
    if (canonical && code && !byBorough.has(canonical)) byBorough.set(canonical, code);
  }

  if (byBorough.size < 30) {
    throw new Error(`GLA lookup only found ${byBorough.size} London local-authority codes`);
  }

  const entries = [...byBorough.entries()];
  const rows = await mapLimit(entries, 6, async ([borough, code], index) => {
    const url = `https://www.ons.gov.uk/visualisations/housingpriceslocal/${encodeURIComponent(code)}/`;
    try {
      const page = await fetchWithRetry(url);
      const html = await page.text();
      const rentByBedroom = parseBedroomRents(html);
      if (Object.keys(rentByBedroom).length < 3) {
        throw new Error(`found ${Object.keys(rentByBedroom).length} bedroom values`);
      }
      console.log(`[${index + 1}/${entries.length}] ${borough} · ${Object.values(rentByBedroom).join(" / ")}`);
      return [borough, rentByBedroom];
    } catch (error) {
      console.warn(`[${index + 1}/${entries.length}] ${borough} · rent failed · ${error.message}`);
      return null;
    }
  });

  const rents = Object.fromEntries(rows.filter(Boolean));
  if (Object.keys(rents).length < 25) {
    throw new Error(`ONS local rent sync only found ${Object.keys(rents).length} London boroughs`);
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(rents, null, 2)}\n`, "utf8");
  console.log(`Wrote ONS bedroom rents for ${Object.keys(rents).length} London boroughs to ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
