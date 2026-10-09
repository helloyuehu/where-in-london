import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";
const POLICE_DATES = "https://data.police.uk/api/crimes-street-dates";
const POLICE_CRIME = "https://data.police.uk/api/crimes-street/all-crime";
const TFL_BASE = "https://api.tfl.gov.uk/Journey/JourneyResults";
const ONS_RENT_DATASET = "https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";

const destinationPostcode = process.env.WORK_POSTCODE || "W1D 3QW";
const arriveBy = (process.env.ARRIVE_BY || "09:00").replace(":", "");
const tflKey = process.env.TFL_APP_KEY || "";
const concurrency = Math.max(1, Number(process.env.SYNC_CONCURRENCY || 6));
const outputPath = path.resolve("lib/data/ward-metrics.generated.json");
const rentCachePath = path.resolve("data/ons-rents-by-borough.json");
const tflIntervalMs = tflKey ? 170 : 1500;

const LONDON_BOROUGHS = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London",
  "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith and Fulham", "Haringey",
  "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames", "Southwark", "Sutton",
  "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
];

const BOROUGH_LOOKUP = new Map(LONDON_BOROUGHS.map((name) => [normaliseName(name), name]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value) {
  return String(value || "ward")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normaliseName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^royal borough of /, "")
    .replace(/^london borough of /, "")
    .replace(/^city of westminster$/, "westminster")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function prop(properties, candidates, fallback = "") {
  for (const candidate of candidates) {
    const value = properties?.[candidate];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function outerRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : [];
  if (geometry.type === "MultiPolygon") return geometry.coordinates?.map((polygon) => polygon[0]).filter(Boolean) || [];
  return [];
}

function signedRingArea(ring) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    crossSum += cross;
    xSum += (ring[j][0] + ring[i][0]) * cross;
    ySum += (ring[j][1] + ring[i][1]) * cross;
  }
  if (Math.abs(crossSum) < 1e-12) {
    const coords = ring.filter((item) => Number.isFinite(item?.[0]) && Number.isFinite(item?.[1]));
    const lng = coords.reduce((sum, item) => sum + item[0], 0) / Math.max(coords.length, 1);
    const lat = coords.reduce((sum, item) => sum + item[1], 0) / Math.max(coords.length, 1);
    return { lat, lng };
  }
  return { lng: xSum / (3 * crossSum), lat: ySum / (3 * crossSum) };
}

function referencePoint(geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return null;
  const ring = [...rings].sort((a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a)))[0];
  return ringCentroid(ring);
}

async function fetchWithRetry(url, init, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1500);
        continue;
      }
      throw new Error(`${response.status} ${response.statusText} · ${url}`);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1200);
    }
  }
  throw lastError || new Error(`Request failed · ${url}`);
}

async function fetchJson(url, init) {
  const response = await fetchWithRetry(url, init);
  return response.json();
}

async function optionalJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch {
    return fallback;
  }
}

async function latestPoliceMonth() {
  const dates = await fetchJson(POLICE_DATES);
  return dates?.[0]?.date || null;
}

async function crimeForPoint(point, month) {
  const url = new URL(POLICE_CRIME);
  url.searchParams.set("lat", String(point.lat));
  url.searchParams.set("lng", String(point.lng));
  if (month) url.searchParams.set("date", month);
  const crimes = await fetchJson(url);
  return {
    month: month || "latest",
    total: Array.isArray(crimes) ? crimes.length : 0,
    radiusMiles: 1,
    source: "data.police.uk",
  };
}

function normaliseMode(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("walk")) return "walk";
  if (value.includes("underground") || value.includes("tube")) return "tube";
  if (value.includes("bus")) return "bus";
  if (value.includes("dlr")) return "dlr";
  if (value.includes("overground")) return "overground";
  if (value.includes("tram")) return "tram";
  return "rail";
}

function normaliseJourney(journey) {
  if (!journey) return null;
  return {
    minutes: Number(journey.duration || 0),
    legs: Array.isArray(journey.legs)
      ? journey.legs.map((leg) => ({
          mode: normaliseMode(leg?.mode?.name),
          line: leg?.routeOptions?.[0]?.name || leg?.instruction?.summary || undefined,
          minutes: Number(leg?.duration || 0),
        }))
      : [],
  };
}

function nextTuesday() {
  const date = new Date();
  const day = date.getUTCDay();
  let delta = (2 - day + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

const journeyDate = process.env.JOURNEY_DATE || nextTuesday();
let tflQueue = Promise.resolve();
let nextTflStart = 0;

function scheduleTflRequest(task) {
  const scheduled = tflQueue.then(async () => {
    const wait = Math.max(0, nextTflStart - Date.now());
    if (wait) await sleep(wait);
    nextTflStart = Date.now() + tflIntervalMs;
    return task();
  });
  tflQueue = scheduled.catch(() => undefined);
  return scheduled;
}

async function tflJourney(point, mode) {
  return scheduleTflRequest(async () => {
    const from = `${point.lat},${point.lng}`;
    const url = new URL(`${TFL_BASE}/${encodeURIComponent(from)}/to/${encodeURIComponent(destinationPostcode)}`);
    if (mode === "walking") url.searchParams.set("mode", "walking");
    url.searchParams.set("timeIs", "arriving");
    url.searchParams.set("time", arriveBy);
    url.searchParams.set("date", journeyDate);
    url.searchParams.set("journeyPreference", "leasttime");
    if (tflKey) url.searchParams.set("app_key", tflKey);
    const payload = await fetchJson(url);
    return normaliseJourney(payload?.journeys?.[0]);
  });
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/");
}

function absoluteOnsUrl(href) {
  if (href.startsWith("http")) return href;
  return new URL(href, "https://www.ons.gov.uk").toString();
}

function parseMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value ?? "").replace(/[£,\s]/g, "").replace(/[^0-9.-]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function canonicalBorough(value) {
  return BOROUGH_LOOKUP.get(normaliseName(value)) || null;
}

function bedroomKeyFromLabel(value) {
  const label = normaliseName(value);
  if (/studio/.test(label)) return "studio";
  if (/\b1\b/.test(label) && /bed/.test(label)) return "1";
  if (/\b2\b/.test(label) && /bed/.test(label)) return "2";
  if (/\b3\b/.test(label) && /bed/.test(label)) return "3";
  if ((/\b4\b/.test(label) || /four/.test(label)) && /bed/.test(label)) return "4+";
  return null;
}

function mergeRent(target, borough, key, value) {
  if (!borough || !key || !value) return;
  target[borough] ||= {};
  target[borough][key] = Math.round(value);
}

function extractWideRent(rows, target) {
  const maxHeaderRows = Math.min(rows.length, 50);
  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    const width = Math.max(...rows.slice(Math.max(0, rowIndex - 2), rowIndex + 1).map((row) => row.length), 0);
    const headers = Array.from({ length: width }, (_, columnIndex) => {
      const parts = [];
      for (let offset = Math.max(0, rowIndex - 2); offset <= rowIndex; offset += 1) {
        const value = rows[offset]?.[columnIndex];
        if (value !== undefined && value !== null && String(value).trim()) parts.push(String(value));
      }
      return parts.join(" ");
    });

    const bedroomColumns = new Map();
    headers.forEach((header, index) => {
      const key = bedroomKeyFromLabel(header);
      if (key && !bedroomColumns.has(key)) bedroomColumns.set(key, index);
    });
    if (bedroomColumns.size < 3) continue;

    let areaColumn = headers.findIndex((header) => /local authority|area name|geography|area/.test(normaliseName(header)));
    if (areaColumn < 0) areaColumn = 0;

    for (let r = rowIndex + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const borough = canonicalBorough(row[areaColumn]);
      if (!borough) continue;
      for (const [key, columnIndex] of bedroomColumns) {
        mergeRent(target, borough, key, parseMoney(row[columnIndex]));
      }
    }
  }
}

function extractLongRent(rows, target) {
  const maxHeaderRows = Math.min(rows.length, 50);
  for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
    const headers = (rows[rowIndex] || []).map((value) => normaliseName(value));
    const areaColumn = headers.findIndex((header) => /local authority|area name|geography/.test(header));
    const bedroomColumn = headers.findIndex((header) => /bedroom|property size|number of bedrooms/.test(header));
    const priceColumn = headers.findIndex((header) => /average.*rent|monthly.*rent|rent price|price/.test(header));
    if (areaColumn < 0 || bedroomColumn < 0 || priceColumn < 0) continue;

    for (let r = rowIndex + 1; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const borough = canonicalBorough(row[areaColumn]);
      const key = bedroomKeyFromLabel(row[bedroomColumn]);
      mergeRent(target, borough, key, parseMoney(row[priceColumn]));
    }
  }
}

function extractRentByBorough(workbook) {
  const output = {};
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: null });
    extractWideRent(rows, output);
    extractLongRent(rows, output);
  }
  return output;
}

async function fetchLatestOnsRents() {
  try {
    const page = await fetchWithRetry(ONS_RENT_DATASET);
    const html = await page.text();
    const hrefs = [...html.matchAll(/href=["']([^"']+\.xlsx[^"']*)["']/gi)].map((match) => decodeHtml(match[1]));
    if (!hrefs.length) throw new Error("No ONS workbook link found");

    const workbookResponse = await fetchWithRetry(absoluteOnsUrl(hrefs[0]));
    const buffer = Buffer.from(await workbookResponse.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const rents = extractRentByBorough(workbook);
    const covered = Object.keys(rents).length;
    if (covered < 20) throw new Error(`ONS rent parser only found ${covered} London boroughs`);

    await mkdir(path.dirname(rentCachePath), { recursive: true });
    await writeFile(rentCachePath, `${JSON.stringify(rents, null, 2)}\n`, "utf8");
    console.log(`ONS rent data loaded for ${covered} London boroughs.`);
    return rents;
  } catch (error) {
    console.warn(`ONS rent refresh failed · ${error.message}`);
    return optionalJson("data/ons-rents-by-borough.json", {});
  }
}

function buildProfile(ward) {
  return {
    summary: `${ward.name} is an official electoral ward in ${ward.borough}. Commute is measured from the ward reference point, reported crime uses a one-mile radius, and rent uses the latest available ONS borough-level average for the selected bedroom count.`,
    tags: [ward.borough, "Official ward"],
    source: "GLA ward geography + ONS + Police.uk + TfL",
  };
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
  console.log(`Syncing every London ward → ${destinationPostcode} · arrive by ${arriveBy} · weekday ${journeyDate}`);
  console.log(tflKey
    ? "TfL registered-key mode enabled."
    : "TfL anonymous mode enabled; requests are throttled below the anonymous 50/minute limit.");

  const [wards, policeMonth, rentsByBorough] = await Promise.all([
    fetchJson(GLA_WARDS),
    latestPoliceMonth(),
    fetchLatestOnsRents(),
  ]);

  const wardRows = (wards.features || []).map((feature, index) => {
    const properties = feature.properties || {};
    const name = prop(properties, ["ward_name", "WARD_NAME"], `Ward ${index + 1}`);
    const code = prop(properties, ["ward_code", "WARD_CODE"], slug(name));
    const borough = prop(properties, ["la_name", "LA_NAME"], "London");
    const point = referencePoint(feature.geometry);
    return { code, name, borough, point };
  }).filter((ward) => ward.point && Number.isFinite(ward.point.lat) && Number.isFinite(ward.point.lng));

  console.log(`${wardRows.length} official wards loaded · Police month ${policeMonth || "latest"}`);

  const synced = await mapLimit(wardRows, concurrency, async (ward, index) => {
    const prefix = `[${index + 1}/${wardRows.length}] ${ward.name}`;
    let crime = null;
    let publicTransport = null;
    let walking = null;

    try {
      crime = await crimeForPoint(ward.point, policeMonth);
    } catch (error) {
      console.warn(`${prefix} · crime failed · ${error.message}`);
    }

    try {
      [publicTransport, walking] = await Promise.all([
        tflJourney(ward.point, "publicTransport"),
        tflJourney(ward.point, "walking"),
      ]);
    } catch (error) {
      console.warn(`${prefix} · commute failed · ${error.message}`);
    }

    const canonical = canonicalBorough(ward.borough) || ward.borough;
    const rentByBedroom = rentsByBorough[canonical] || null;
    const profile = buildProfile(ward);
    const complete = Boolean(crime && publicTransport && walking && rentByBedroom);
    console.log(`${prefix} · ${complete ? "complete" : "partial"}`);

    return {
      id: ward.code,
      wardCode: ward.code,
      name: ward.name,
      borough: ward.borough,
      referencePoint: { name: `${ward.name} ward reference point`, ...ward.point },
      destinationPostcode,
      arriveBy,
      journeyDate,
      commute: { publicTransport, walking },
      crime,
      rentByBedroom,
      profile,
      complete,
      sources: {
        geography: "Greater London Authority · London Wards (2022)",
        crime: crime ? "data.police.uk" : null,
        commute: publicTransport || walking ? "Transport for London Journey Planner API" : null,
        rent: rentByBedroom ? "ONS Price Index of Private Rents · local authority by property size" : null,
        profile: profile.source,
      },
    };
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    destinationPostcode,
    arriveBy,
    journeyDate,
    policeMonth,
    wardCount: synced.length,
    completeCount: synced.filter((item) => item.complete).length,
    wards: synced,
  }, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(`${synced.filter((item) => item.complete).length}/${synced.length} wards have commute, crime and rent.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
