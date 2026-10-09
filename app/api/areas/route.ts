import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";

export const revalidate = 86400;

const LONDON_BOROUGHS = new Set([
  "barking and dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city of london",
  "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith and fulham", "haringey",
  "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington and chelsea", "kingston upon thames",
  "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond upon thames", "southwark", "sutton",
  "tower hamlets", "waltham forest", "wandsworth", "westminster",
]);

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
  return LONDON_BOROUGHS.has(normalise(borough));
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

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), filePath), "utf8")) as T;
  } catch {
    return fallback;
  }
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
  if (censusProfile?.source) {
    sources.push({ label: "profile", detail: censusProfile.source });
  }
  return sources.filter((source, index, all) => all.findIndex((candidate) => candidate.detail === source.detail) === index);
}

export async function GET() {
  try {
    const [wardsResponse, generated, censusProfiles] = await Promise.all([
      fetch(GLA_WARDS, { next: { revalidate } }),
      readJson<GeneratedPayload>("lib/data/ward-metrics.generated.json", { wards: [] }),
      readJson<CensusProfilePayload>("data/ward-profiles.generated.json", { profiles: {} }),
    ]);
    if (!wardsResponse.ok) throw new Error("Official GLA ward request failed");

    const allWards = (await wardsResponse.json()) as FeatureCollection<Geometry>;
    const wardFeatures = allWards.features.filter(isLondonFeature);
    const generatedByCode = new Map<string, GeneratedWard>();
    for (const ward of generated.wards || []) {
      const code = ward.wardCode || ward.id;
      if (code) generatedByCode.set(code, ward);
    }

    const areas = wardFeatures.map((feature: Feature<Geometry>, index) => {
      const properties = feature.properties || {};
      const wardCode = String(properties.ward_code || `ward-${index + 1}`);
      const name = String(properties.ward_name || `Ward ${index + 1}`);
      const borough = String(properties.la_name || "London");
      const point = referencePoint(feature.geometry);
      const metrics = generatedByCode.get(wardCode);
      const censusProfile = censusProfiles.profiles?.[wardCode];
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
              summary: `${name} is an official electoral ward in ${borough}. Detailed demographic context is still being populated from official London data.`,
              tags: [borough],
            };
      const hardMetricsReady = Boolean(commute.publicTransport && crime && rentByBedroom);
      const anyMetrics = Boolean(commute.publicTransport || commute.walking || crime || rentByBedroom);

      return {
        id: wardCode,
        wardCode,
        name,
        borough,
        referencePoint: { name: `${name} ward reference point`, ...point },
        commute,
        crime,
        rentByBedroom,
        profile,
        sources: sourceList(metrics, censusProfile),
        dataStatus: hardMetricsReady ? "ready" : anyMetrics ? "partial" : "pending",
      };
    });

    return NextResponse.json({
      areas,
      wardCount: areas.length,
      readyCount: areas.filter((area) => area.dataStatus === "ready").length,
      profileCount: areas.filter((area) => Boolean(censusProfiles.profiles?.[area.wardCode])).length,
      generatedAt: generated.generatedAt || null,
      profileGeneratedAt: censusProfiles.generatedAt || null,
      metricsDestinationPostcode: generated.destinationPostcode || null,
      arriveBy: generated.arriveBy || null,
      policeMonth: generated.policeMonth || null,
      source: "Greater London Authority · London Wards (2022)",
    });
  } catch (error) {
    return NextResponse.json(
      {
        areas: [],
        error: "London ward data is temporarily unavailable.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
