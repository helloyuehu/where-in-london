import { NextRequest, NextResponse } from "next/server";

export const revalidate = 2592000;

export async function GET(request: NextRequest) {
  const postcode = request.nextUrl.searchParams.get("postcode")?.trim();
  if (!postcode) {
    return NextResponse.json({ error: "Postcode is required." }, { status: 400 });
  }

  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`, {
      next: { revalidate },
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Postcode not found." }, { status: 404 });
    }

    const data = await response.json();
    if (!data?.result?.latitude || !data?.result?.longitude) {
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
