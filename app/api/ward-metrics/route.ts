import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type GeneratedWard = {
  id: string;
  name: string;
  borough: string;
  referencePoint: { name: string; lat: number; lng: number };
  commute: {
    publicTransport: { minutes: number; legs?: unknown[] } | null;
    walking: { minutes: number; legs?: unknown[] } | null;
  };
  crime: { month: string; total: number; radiusMiles: number } | null;
  rentByBedroom: Record<string, number> | null;
  profile: { summary: string; tags?: string[] } | null;
  complete: boolean;
  sources?: Record<string, string | null>;
};

type GeneratedPayload = {
  generatedAt?: string;
  destinationPostcode?: string;
  arriveBy?: string;
  policeMonth?: string | null;
  wardCount?: number;
  completeCount?: number;
  wards?: GeneratedWard[];
};

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "lib", "data", "ward-metrics.generated.json");
    const payload = JSON.parse(await readFile(filePath, "utf8")) as GeneratedPayload;
    const areas = (payload.wards || [])
      .filter((ward) => ward.complete && ward.commute.publicTransport && ward.commute.walking && ward.crime && ward.rentByBedroom && ward.profile)
      .map((ward) => ({
        id: ward.id,
        name: ward.name,
        borough: ward.borough,
        referencePoint: ward.referencePoint,
        commute: {
          publicTransport: ward.commute.publicTransport,
          walking: ward.commute.walking,
        },
        crime: ward.crime,
        rentByBedroom: ward.rentByBedroom,
        profile: {
          summary: ward.profile?.summary ?? "",
          tags: ward.profile?.tags ?? [],
        },
        sources: Object.entries(ward.sources || {})
          .filter(([, value]) => Boolean(value))
          .map(([label, detail]) => ({ label, detail: String(detail) })),
      }));

    return NextResponse.json({
      ...payload,
      areas,
      usingGeneratedData: areas.length > 0,
    });
  } catch {
    return NextResponse.json({
      areas: [],
      usingGeneratedData: false,
      status: "No generated ward metrics yet. Run npm run sync:wards after configuring the official data inputs.",
    });
  }
}
