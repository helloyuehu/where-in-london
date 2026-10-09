import { NextResponse } from "next/server";

const GLA_BOUNDARY = "https://gis.london.gov.uk/arcgis/rest/services/apps/planning_data_map_02/FeatureServer/303/query?where=1%3D1&outFields=name&returnGeometry=true&outSR=4326&f=geojson";
const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/cultural_infrastructure_map_context_layers/MapServer/3/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";

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
    return NextResponse.json({ boundary, wards, source: "Greater London Authority" });
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
