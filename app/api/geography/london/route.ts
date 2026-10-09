import { NextResponse } from "next/server";

const GLA_BOUNDARY = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson";
const GLA_WARDS = "https://gis.london.gov.uk/arcgis/rest/services/apps/webmap_context_layer/MapServer/9/query?where=1%3D1&outFields=ward_code%2Cward_name%2Cla_name%2Cla_gss_code&returnGeometry=true&outSR=4326&f=geojson";

export const revalidate = 86400;

const LONDON_BOROUGHS = new Set([
  "barking and dagenham", "barnet", "bexley", "brent", "bromley", "camden", "city of london",
  "croydon", "ealing", "enfield", "greenwich", "hackney", "hammersmith and fulham", "haringey",
  "harrow", "havering", "hillingdon", "hounslow", "islington", "kensington and chelsea", "kingston upon thames",
  "lambeth", "lewisham", "merton", "newham", "redbridge", "richmond upon thames", "southwark", "sutton",
  "tower hamlets", "waltham forest", "wandsworth", "westminster",
]);

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

function londonOnly(collection: any) {
  const features = Array.isArray(collection?.features)
    ? collection.features.filter((feature: any) => {
        const properties = feature?.properties || {};
        const borough = properties.la_name || properties.LA_NAME || properties.lad22nm || properties.LAD22NM;
        return LONDON_BOROUGHS.has(normalise(borough));
      })
    : [];
  return { ...collection, features };
}

export async function GET() {
  try {
    const [boundaryResponse, wardsResponse] = await Promise.all([
      fetch(GLA_BOUNDARY, { next: { revalidate } }),
      fetch(GLA_WARDS, { next: { revalidate } }),
    ]);

    if (!boundaryResponse.ok || !wardsResponse.ok) {
      throw new Error("Official GLA geography request failed");
    }

    const [boundary, allWards] = await Promise.all([boundaryResponse.json(), wardsResponse.json()]);
    const wards = londonOnly(allWards);

    return NextResponse.json({
      boundary,
      wards,
      wardCount: wards.features.length,
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
