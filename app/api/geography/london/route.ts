import { NextResponse } from "next/server";

const GLA_BOUNDARY = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";

export const revalidate = 60 * 60 * 24;

export async function GET() {
  try {
    const [boundaryResponse, wardsResponse] = await Promise.all([
      fetch(GLA_BOUNDARY, { next: { revalidate } }),
      fetch(GLA_WARDS, { next: { revalidate } }),
    ]);

    if (!boundaryResponse.ok || !wardsResponse.ok) {
      throw new Error("Official GLA geography request failed");
    }

    const [boundary, wards] = await Promise.all([boundaryResponse.json(), wardsResponse.json()]);
    return NextResponse.json({
      boundary,
      wards,
      source: "Greater London Authority · London Wards (2022)",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Official London geography is temporarily unavailable.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
