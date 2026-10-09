import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/cultural_infrastructure_map_context_layers/MapServer/3/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
const POLICE_DATES = "https://data.police.uk/api/crimes-street-dates";
const POLICE_CRIME = "https://data.police.uk/api/crimes-street/all-crime";
const TFL_BASE = "https://api.tfl.gov.uk/Journey/JourneyResults";

const destinationPostcode = process.env.WORK_POSTCODE || "W1D 3QW";
const arriveBy = (process.env.ARRIVE_BY || "09:00").replace(":", "");
const tflKey = process.env.TFL_APP_KEY || "";
const concurrency = Math.max(1, Number(process.env.SYNC_CONCURRENCY || 4));
const outputPath = path.resolve("lib/data/ward-metrics.generated.json");

const transitModes = "public-bus,overground,train,tube,dlr,tram,walking";

function slug(value) {
  return String(value || "ward")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} · ${url}`);
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

async function tflJourney(point, mode) {
  if (!tflKey) return null;
  const from = `${point.lat},${point.lng}`;
  const url = new URL(`${TFL_BASE}/${encodeURIComponent(from)}/to/${encodeURIComponent(destinationPostcode)}`);
  url.searchParams.set("mode", mode === "walking" ? "walking" : transitModes);
  url.searchParams.set("timeIs", "arriving");
  url.searchParams.set("time", arriveBy);
  url.searchParams.set("journeyPreference", "leasttime");
  url.searchParams.set("app_key", tflKey);
  const payload = await fetchJson(url);
  return normaliseJourney(payload?.journeys?.[0]);
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
  console.log(`Syncing London wards → ${destinationPostcode} · arrive by ${arriveBy}`);
  if (!tflKey) console.warn("TFL_APP_KEY is missing. Commute fields will remain null.");

  const [wards, policeMonth, rentsByBorough, profilesByWard] = await Promise.all([
    fetchJson(GLA_WARDS),
    latestPoliceMonth(),
    optionalJson("data/ons-rents-by-borough.json", {}),
    optionalJson("data/ward-profiles.json", {}),
  ]);

  const wardRows = (wards.features || []).map((feature, index) => {
    const properties = feature.properties || {};
    const name = prop(properties, ["ward_name", "WARD_NAME", "name", "NAME", "wd24nm", "WD24NM"], `Ward ${index + 1}`);
    const code = prop(properties, ["ward_code", "WARD_CODE", "gss_code", "GSS_CODE", "wd24cd", "WD24CD"], slug(name));
    const borough = prop(properties, ["borough", "BOROUGH", "borough_name", "BOROUGH_NAME", "lad_name", "LAD_NAME", "lad24nm", "LAD24NM"], "London");
    const point = referencePoint(feature.geometry);
    return { code, name, borough, point };
  }).filter((ward) => ward.point && Number.isFinite(ward.point.lat) && Number.isFinite(ward.point.lng));

  console.log(`${wardRows.length} wards loaded · Police month ${policeMonth || "latest"}`);

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

    if (tflKey) {
      try {
        [publicTransport, walking] = await Promise.all([
          tflJourney(ward.point, "publicTransport"),
          tflJourney(ward.point, "walking"),
        ]);
      } catch (error) {
        console.warn(`${prefix} · commute failed · ${error.message}`);
      }
    }

    const rentByBedroom = rentsByBorough[ward.borough] || null;
    const profile = profilesByWard[ward.code] || profilesByWard[ward.name] || {
      summary: `${ward.name} is an official London ward in ${ward.borough}. Detailed profile evidence has not yet been loaded.`,
      tags: [],
      source: "GLA ward geography",
    };

    const complete = Boolean(crime && publicTransport && walking && rentByBedroom && profile?.summary);
    console.log(`${prefix} · ${complete ? "complete" : "partial"}`);

    return {
      id: slug(ward.code || ward.name),
      wardCode: ward.code,
      name: ward.name,
      borough: ward.borough,
      referencePoint: { name: `${ward.name} centroid`, ...ward.point },
      destinationPostcode,
      arriveBy,
      commute: { publicTransport, walking },
      crime,
      rentByBedroom,
      profile,
      complete,
      sources: {
        geography: "Greater London Authority",
        crime: crime ? "data.police.uk" : null,
        commute: publicTransport || walking ? "Transport for London Journey Planner API" : null,
        rent: rentByBedroom ? "ONS Price Index of Private Rents" : null,
        profile: profile?.source || null,
      },
    };
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    destinationPostcode,
    arriveBy,
    policeMonth,
    wardCount: synced.length,
    completeCount: synced.filter((item) => item.complete).length,
    wards: synced,
  }, null, 2)}\n`, "utf8");

  console.log(`Wrote ${outputPath}`);
  console.log(`${synced.filter((item) => item.complete).length}/${synced.length} wards have all four data groups.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
