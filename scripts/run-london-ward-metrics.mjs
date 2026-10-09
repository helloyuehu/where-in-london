import { readFile } from "node:fs/promises";
import path from "node:path";

const originalFetch = globalThis.fetch;
const TARGET_AREA_COUNT = Math.max(40, Number(process.env.TARGET_AREA_COUNT || 80));
const deferCommute = process.env.SYNC_COMMUTE !== "1";

const LONDON_BOROUGHS = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London",
  "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith and Fulham", "Haringey",
  "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames", "Southwark", "Sutton",
  "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
];

const LONDON_BOROUGH_SET = new Set(LONDON_BOROUGHS.map(normalise));

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

function isWardLayer(url) {
  return url.includes("gis.london.gov.uk") && url.includes("MapServer/9/query");
}

function isTflJourney(url) {
  return url.startsWith("https://api.tfl.gov.uk/Journey/JourneyResults/");
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
    return {
      lng: ring.reduce((sum, point) => sum + point[0], 0) / Math.max(ring.length, 1),
      lat: ring.reduce((sum, point) => sum + point[1], 0) / Math.max(ring.length, 1),
    };
  }
  return { lng: xSum / (3 * crossSum), lat: ySum / (3 * crossSum) };
}

function referencePoint(geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return null;
  const ring = [...rings].sort((a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a)))[0];
  return ringCentroid(ring);
}

function distanceSq(a, b) {
  const scale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dx = (a.lng - b.lng) * scale;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

async function loadPriorities() {
  try {
    const value = await readFile(path.resolve("data/area-priorities.json"), "utf8");
    const priorities = JSON.parse(value);
    return Array.isArray(priorities) ? priorities : [];
  } catch {
    return [];
  }
}

function selectRepresentativeAreas(features, priorities) {
  const rows = features
    .map((feature) => {
      const properties = feature?.properties || {};
      const officialName = String(properties.ward_name || properties.WARD_NAME || "Area");
      const borough = String(properties.la_name || properties.LA_NAME || "London");
      const point = referencePoint(feature.geometry);
      return { feature, officialName, borough, point, displayName: officialName };
    })
    .filter((row) => row.point && LONDON_BOROUGH_SET.has(normalise(row.borough)));

  const used = new Set();
  const selected = [];

  function add(row, displayName = row.officialName) {
    const code = String(row.feature.properties?.ward_code || row.feature.properties?.WARD_CODE || row.officialName);
    if (used.has(code) || selected.length >= TARGET_AREA_COUNT) return false;
    used.add(code);
    selected.push({ ...row, displayName });
    return true;
  }

  function priorityMatch(priority) {
    const query = normalise(priority.query || priority.label);
    const borough = normalise(priority.borough);
    return rows.find((row) => {
      const code = String(row.feature.properties?.ward_code || row.officialName);
      return !used.has(code)
        && normalise(row.borough) === borough
        && normalise(row.officialName).includes(query);
    });
  }

  // First guarantee coverage across all 33 London local authorities.
  for (const borough of LONDON_BOROUGHS) {
    const preferred = priorities.find((item) => normalise(item.borough) === normalise(borough));
    const matched = preferred ? priorityMatch(preferred) : null;
    if (matched) {
      add(matched, preferred.label || matched.officialName);
      continue;
    }

    const boroughRows = rows.filter((row) => normalise(row.borough) === normalise(borough));
    if (!boroughRows.length) continue;
    const centre = {
      lat: boroughRows.reduce((sum, row) => sum + row.point.lat, 0) / boroughRows.length,
      lng: boroughRows.reduce((sum, row) => sum + row.point.lng, 0) / boroughRows.length,
    };
    boroughRows.sort((a, b) => distanceSq(a.point, centre) - distanceSq(b.point, centre));
    add(boroughRows[0]);
  }

  // Then favour recognisable neighbourhood names from the curated priority list.
  for (const priority of priorities) {
    if (selected.length >= TARGET_AREA_COUNT) break;
    const matched = priorityMatch(priority);
    if (matched) add(matched, priority.label || matched.officialName);
  }

  // Fill any remaining slots by maximising geographic spread across London.
  while (selected.length < Math.min(TARGET_AREA_COUNT, rows.length)) {
    let best = null;
    let bestScore = -1;
    for (const row of rows) {
      const code = String(row.feature.properties?.ward_code || row.officialName);
      if (used.has(code)) continue;
      const score = selected.length
        ? Math.min(...selected.map((chosen) => distanceSq(row.point, chosen.point)))
        : 0;
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    if (!best) break;
    add(best);
  }

  return selected.map((row) => ({
    ...row.feature,
    properties: {
      ...(row.feature.properties || {}),
      boundary_name: row.officialName,
      area_label: row.displayName,
      ward_name: row.displayName,
    },
  }));
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (deferCommute && isTflJourney(url)) {
    return new Response(JSON.stringify({ journeys: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const response = await originalFetch(input, init);
  if (!isWardLayer(url) || !response.ok) return response;

  const payload = await response.json();
  const originalCount = Array.isArray(payload?.features) ? payload.features.length : 0;
  const priorities = await loadPriorities();
  const features = selectRepresentativeAreas(payload?.features || [], priorities);

  console.log(`London decision model: ${originalCount} source features → ${features.length} representative areas.`);
  if (deferCommute) console.log("TfL commute is deferred to the app and calculated progressively after rent + crime filtering.");

  return new Response(JSON.stringify({ ...payload, features }), {
    status: response.status,
    statusText: response.statusText,
    headers: { "content-type": "application/json" },
  });
};

await import("./sync-ward-metrics.mjs");
