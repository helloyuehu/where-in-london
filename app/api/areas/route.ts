import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";

export const revalidate = 60 * 60 * 24;

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

async function readGenerated(): Promise<GeneratedPayload> {
  try {
    const filePath = path.join(process.cwd(), "lib", "data", "ward-metrics.generated.json");
    return JSON.parse(await readFile(filePath, "utf8")) as GeneratedPayload;
  } catch {
    return { wards: [] };
  }
}

function sourceList(ward: GeneratedWard | undefined) {
  if (!ward?.sources) return [{ label: "geography", detail: "Greater London Authority · London Wards (2022)" }];
  return [
    { label: "geography", detail: "Greater London Authority · London Wards (2022)" },
    ...Object.entries(ward.sources)
      .filter(([, detail]) => Boolean(detail))
      .map(([label, detail]) => ({ label, detail: String(detail) })),
  ];
}

export async function GET() {
  try {
    const [wardsResponse, generated] = await Promise.all([
      fetch(GLA_WARDS, { next: { revalidate } }),
      readGenerated(),
    ]);
    if (!wardsResponse.ok) throw new Error("Official GLA ward request failed");

    const wards = (await wardsResponse.json()) as FeatureCollection<Geometry>;
    const generatedByCode = new Map<string, GeneratedWard>();
    for (const ward of generated.wards || []) {
      const code = ward.wardCode || ward.id;
      if (code) generatedByCode.set(code, ward);
    }

    const areas = wards.features.map((feature: Feature<Geometry>, index) => {
      const properties = feature.properties || {};
      const wardCode = String(properties.ward_code || `ward-${index + 1}`);
      const name = String(properties.ward_name || `Ward ${index + 1}`);
      const borough = String(properties.la_name || "London");
      const point = referencePoint(feature.geometry);
      const metrics = generatedByCode.get(wardCode);
      const commute = {
        publicTransport: metrics?.commute?.publicTransport ?? null,
        walking: metrics?.commute?.walking ?? null,
      };
      const crime = metrics?.crime ?? null;
      const rentByBedroom = metrics?.rentByBedroom ?? null;
      const profile = metrics?.profile?.summary
        ? { summary: metrics.profile.summary, tags: metrics.profile.tags || [] }
        : {
            summary: `${name} is an official electoral ward in ${borough}. Detailed demographic context is still being populated from official London data.`,
            tags: [borough],
          };
      const hardMetricsReady = Boolean(commute.publicTransport && commute.walking && crime && rentByBedroom);
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
        sources: sourceList(metrics),
        dataStatus: hardMetricsReady ? "ready" : anyMetrics ? "partial" : "pending",
      };
    });

    return NextResponse.json({
      areas,
      wardCount: areas.length,
      readyCount: areas.filter((area) => area.dataStatus === "ready").length,
      generatedAt: generated.generatedAt || null,
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
