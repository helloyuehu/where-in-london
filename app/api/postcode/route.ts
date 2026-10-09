import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rawPostcode = request.nextUrl.searchParams.get("postcode")?.trim();
  if (!rawPostcode) {
    return NextResponse.json({ error: "Postcode is required." }, { status: 400 });
  }

  const postcode = rawPostcode.replace(/\s+/g, "").toUpperCase();

  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Postcode not found." }, { status: 404 });
    }

    const data = await response.json();
    if (!Number.isFinite(data?.result?.latitude) || !Number.isFinite(data?.result?.longitude)) {
      return NextResponse.json({ error: "Postcode coordinates unavailable." }, { status: 404 });
    }

    return NextResponse.json({
      lat: data.result.latitude,
      lng: data.result.longitude,
      postcode: data.result.postcode,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Postcode lookup is temporarily unavailable.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
