import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";
const TARGET_AREA_COUNT = 80;

export const revalidate = 86400;

const LONDON_BOROUGHS = [
  "Barking and Dagenham", "Barnet", "Bexley", "Brent", "Bromley", "Camden", "City of London",
  "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Hammersmith and Fulham", "Haringey",
  "Harrow", "Havering", "Hillingdon", "Hounslow", "Islington", "Kensington and Chelsea", "Kingston upon Thames",
  "Lambeth", "Lewisham", "Merton", "Newham", "Redbridge", "Richmond upon Thames", "Southwark", "Sutton",
  "Tower Hamlets", "Waltham Forest", "Wandsworth", "Westminster",
];
const LONDON_BOROUGH_SET = new Set(LONDON_BOROUGHS.map((name) => normalise(name)));

type GeneratedWard = {
  id?: string;
  wardCode?: string;
  name?: string;
  borough?: string;
  referencePoint?: { name?: string; lat: number; lng: number };
  commute?: {
    publicTransport?: { minutes: number; legs?: unknown[] } | null;
    walking?: { minutes: number; legs?: unknown[] } | null;
  };
  crime?: { month: string; total: number; radiusMiles: number } | null;
  rentByBedroom?: Record<string, number> | null;
  profile?: { summary?: string; tags?: string[]; source?: string } | null;
  sources?: Record<string, string | null>;
};

type GeneratedPayload = {
  generatedAt?: string | null;
  destinationPostcode?: string;
  arriveBy?: string;
  policeMonth?: string | null;
  wards?: GeneratedWard[];
};

type CensusProfile = {
  summary: string;
  tags?: string[];
  source?: string;
};

type CensusProfilePayload = {
  generatedAt?: string | null;
  profiles?: Record<string, CensusProfile>;
};

type AreaPriority = {
  label: string;
  query: string;
  borough: string;
};

type WardRow = {
  feature: Feature<Geometry>;
  code: string;
  officialName: string;
  borough: string;
  point: { lat: number; lng: number };
  displayName: string;
};

function normalise(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/^royal borough of /, "")
    .replace(/^london borough of /, "")
    .replace(/^city of westminster$/, "westminster")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isLondonFeature(feature: Feature<Geometry>) {
  const properties = feature.properties || {};
  const borough = properties.la_name || properties.LA_NAME || properties.lad22nm || properties.LAD22NM;
  return LONDON_BOROUGH_SET.has(normalise(borough));
}

function outerRings(geometry: Geometry): Position[][] {
  if (geometry.type === "Polygon") return [(geometry as Polygon).coordinates[0]];
  if (geometry.type === "MultiPolygon") return (geometry as MultiPolygon).coordinates.map((polygon) => polygon[0]);
  return [];
}

function signedRingArea(ring: Position[]) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function ringCentroid(ring: Position[]) {
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
    const lng = ring.reduce((sum, point) => sum + point[0], 0) / Math.max(ring.length, 1);
    const lat = ring.reduce((sum, point) => sum + point[1], 0) / Math.max(ring.length, 1);
    return { lat, lng };
  }
  return { lng: xSum / (3 * crossSum), lat: ySum / (3 * crossSum) };
}

function referencePoint(geometry: Geometry) {
  const rings = outerRings(geometry);
  if (!rings.length) return { lat: 51.5072, lng: -0.1276 };
  const ring = [...rings].sort((a, b) => Math.abs(signedRingArea(b)) - Math.abs(signedRingArea(a)))[0];
  return ringCentroid(ring);
}

function distanceSq(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const scale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const dx = (a.lng - b.lng) * scale;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), filePath), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function selectRepresentativeAreas(features: Feature<Geometry>[], priorities: AreaPriority[]): WardRow[] {
  const rows: WardRow[] = features.filter(isLondonFeature).map((feature, index) => {
    const properties = feature.properties || {};
    const officialName = String(properties.ward_name || `Area ${index + 1}`);
    const code = String(properties.ward_code || `ward-${index + 1}`);
    const borough = String(properties.la_name || "London");
    return {
      feature,
      code,
      officialName,
      borough,
      point: referencePoint(feature.geometry),
      displayName: officialName,
    };
  });

  const used = new Set<string>();
  const selected: WardRow[] = [];

  const add = (row: WardRow, displayName = row.officialName) => {
    if (used.has(row.code) || selected.length >= TARGET_AREA_COUNT) return false;
    used.add(row.code);
    selected.push({ ...row, displayName });
    return true;
  };

  const findPriorityMatch = (priority: AreaPriority) => {
    const query = normalise(priority.query || priority.label);
    return rows.find((row) => !used.has(row.code)
      && normalise(row.borough) === normalise(priority.borough)
      && normalise(row.officialName).includes(query));
  };

  for (const borough of LONDON_BOROUGHS) {
    const priority = priorities.find((item) => normalise(item.borough) === normalise(borough));
    const preferred = priority ? findPriorityMatch(priority) : undefined;
    if (preferred) {
      add(preferred, priority?.label || preferred.officialName);
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

  for (const priority of priorities) {
    if (selected.length >= TARGET_AREA_COUNT) break;
    const matched = findPriorityMatch(priority);
    if (matched) add(matched, priority.label || matched.officialName);
  }

  while (selected.length < Math.min(TARGET_AREA_COUNT, rows.length)) {
    let best: WardRow | null = null;
    let bestScore = -1;
    for (const row of rows) {
      if (used.has(row.code)) continue;
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

  return selected;
}

function sourceList(ward: GeneratedWard | undefined, censusProfile: CensusProfile | undefined) {
  const sources = [
    { label: "geography", detail: "Greater London Authority · London Wards (2022)" },
  ];
  if (ward?.sources) {
    sources.push(
      ...Object.entries(ward.sources)
        .filter(([, detail]) => Boolean(detail))
        .map(([label, detail]) => ({ label, detail: String(detail) })),
    );
  }
  if (censusProfile?.source) sources.push({ label: "profile", detail: censusProfile.source });
  return sources.filter((source, index, all) => all.findIndex((candidate) => candidate.detail === source.detail) === index);
}

export async function GET() {
  try {
    const [wardsResponse, generated, censusProfiles, priorities] = await Promise.all([
      fetch(GLA_WARDS, { next: { revalidate } }),
      readJson<GeneratedPayload>("lib/data/ward-metrics.generated.json", { wards: [] }),
      readJson<CensusProfilePayload>("data/ward-profiles.generated.json", { profiles: {} }),
      readJson<AreaPriority[]>("data/area-priorities.json", []),
    ]);
    if (!wardsResponse.ok) throw new Error("Official GLA ward request failed");

    const allWards = (await wardsResponse.json()) as FeatureCollection<Geometry>;
    const londonFeatures = allWards.features.filter(isLondonFeature);
    const generatedByCode = new Map<string, GeneratedWard>();
    for (const ward of generated.wards || []) {
      const code = ward.wardCode || ward.id;
      if (code) generatedByCode.set(code, ward);
    }

    let selectedRows: WardRow[];
    if (generatedByCode.size >= 40) {
      const generatedNames = new Map<string, string>();
      for (const [code, ward] of generatedByCode) {
        if (ward.name) generatedNames.set(code, ward.name);
      }
      selectedRows = londonFeatures
        .map((feature, index) => {
          const properties = feature.properties || {};
          const code = String(properties.ward_code || `ward-${index + 1}`);
          if (!generatedByCode.has(code)) return null;
          const officialName = String(properties.ward_name || `Area ${index + 1}`);
          const borough = String(properties.la_name || "London");
          return {
            feature,
            code,
            officialName,
            borough,
            point: referencePoint(feature.geometry),
            displayName: generatedNames.get(code) || officialName,
          } satisfies WardRow;
        })
        .filter((row): row is WardRow => Boolean(row));
    } else {
      selectedRows = selectRepresentativeAreas(londonFeatures, priorities);
    }

    const areas = selectedRows.map((row) => {
      const metrics = generatedByCode.get(row.code);
      const censusProfile = censusProfiles.profiles?.[row.code];
      const commute = {
        publicTransport: metrics?.commute?.publicTransport ?? null,
        walking: metrics?.commute?.walking ?? null,
      };
      const crime = metrics?.crime ?? null;
      const rentByBedroom = metrics?.rentByBedroom ?? null;
      const profile = censusProfile?.summary
        ? { summary: censusProfile.summary, tags: censusProfile.tags || [] }
        : metrics?.profile?.summary
          ? { summary: metrics.profile.summary, tags: metrics.profile.tags || [] }
          : {
              summary: `${row.displayName} is represented by an official ward boundary in ${row.borough}. Detailed demographic context is still being populated from official London data.`,
              tags: [row.borough],
            };
      const factsReady = Boolean(crime && rentByBedroom);
      const anyFacts = Boolean(crime || rentByBedroom || commute.publicTransport || commute.walking);

      return {
        id: row.code,
        wardCode: row.code,
        name: metrics?.name || row.displayName,
        boundaryName: row.officialName,
        borough: row.borough,
        referencePoint: { name: `${row.displayName} area reference point`, ...row.point },
        commute,
        crime,
        rentByBedroom,
        profile,
        sources: sourceList(metrics, censusProfile),
        dataStatus: factsReady ? "ready" : anyFacts ? "partial" : "pending",
      };
    });

    return NextResponse.json({
      areas,
      areaCount: areas.length,
      fullWardCount: londonFeatures.length,
      readyCount: areas.filter((area) => area.dataStatus === "ready").length,
      profileCount: areas.filter((area) => Boolean(censusProfiles.profiles?.[area.wardCode])).length,
      generatedAt: generated.generatedAt || null,
      profileGeneratedAt: censusProfiles.generatedAt || null,
      metricsDestinationPostcode: generated.destinationPostcode || null,
      arriveBy: generated.arriveBy || null,
      policeMonth: generated.policeMonth || null,
      selection: "Representative neighbourhood-scale London areas using official ward polygons",
      source: "Greater London Authority · London Wards (2022)",
    });
  } catch (error) {
    return NextResponse.json(
      {
        areas: [],
        error: "London area data is temporarily unavailable.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
