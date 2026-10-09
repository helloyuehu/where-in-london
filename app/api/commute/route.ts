import { NextRequest, NextResponse } from "next/server";

const TFL_BASE = "https://api.tfl.gov.uk/Journey/JourneyResults";
const PUBLIC_TRANSPORT_MODES = "public-bus,overground,train,tube,dlr,tram,walking";
const CACHE_TTL_MS = 60 * 60 * 1000;

type RouteLeg = {
  mode: "walk" | "tube" | "bus" | "rail" | "dlr" | "overground" | "tram";
  line?: string;
  minutes: number;
};

type CommuteOption = {
  minutes: number;
  legs: RouteLeg[];
};

type CacheEntry = {
  expiresAt: number;
  value: {
    publicTransport: CommuteOption | null;
    walking: CommuteOption | null;
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __londonCommuteCache: Map<string, CacheEntry> | undefined;
}

const cache = globalThis.__londonCommuteCache ?? new Map<string, CacheEntry>();
globalThis.__londonCommuteCache = cache;

function normaliseMode(name: unknown): RouteLeg["mode"] {
  const value = String(name || "").toLowerCase();
  if (value.includes("walk")) return "walk";
  if (value.includes("underground") || value.includes("tube")) return "tube";
  if (value.includes("bus")) return "bus";
  if (value.includes("dlr")) return "dlr";
  if (value.includes("overground")) return "overground";
  if (value.includes("tram")) return "tram";
  return "rail";
}

function normaliseJourney(journey: any): CommuteOption | null {
  if (!journey || !Number.isFinite(Number(journey.duration))) return null;
  return {
    minutes: Number(journey.duration),
    legs: Array.isArray(journey.legs)
      ? journey.legs.map((leg: any) => ({
          mode: normaliseMode(leg?.mode?.name),
          line: leg?.routeOptions?.[0]?.name || leg?.instruction?.summary || undefined,
          minutes: Number(leg?.duration || 0),
        }))
      : [],
  };
}

function isWalkingJourney(journey: any) {
  return Array.isArray(journey?.legs)
    && journey.legs.length > 0
    && journey.legs.every((leg: any) => normaliseMode(leg?.mode?.name) === "walk");
}

function isPublicTransportJourney(journey: any) {
  return Array.isArray(journey?.legs)
    && journey.legs.some((leg: any) => normaliseMode(leg?.mode?.name) !== "walk");
}

function nextTuesday() {
  const date = new Date();
  const day = date.getUTCDay();
  let delta = (2 - day + 7) % 7;
  if (delta === 0) delta = 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

async function fetchJourney(
  lat: number,
  lng: number,
  destinationPostcode: string,
  arriveBy: string,
  modes: string,
  useMultiModalCall: boolean,
) {
  const from = `${lat},${lng}`;
  const url = new URL(`${TFL_BASE}/${encodeURIComponent(from)}/to/${encodeURIComponent(destinationPostcode)}`);
  url.searchParams.set("mode", modes);
  url.searchParams.set("timeIs", "arriving");
  url.searchParams.set("time", arriveBy.replace(":", ""));
  url.searchParams.set("date", nextTuesday());
  url.searchParams.set("journeyPreference", "leasttime");
  if (useMultiModalCall) url.searchParams.set("useMultiModalCall", "true");
  if (process.env.TFL_APP_KEY) url.searchParams.set("app_key", process.env.TFL_APP_KEY);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`TfL Journey Planner returned ${response.status}`);
  return response.json();
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const destinationPostcode = String(params.get("destination") || "").trim().toUpperCase();
  const arriveBy = String(params.get("arriveBy") || "09:00").trim();

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !destinationPostcode) {
    return NextResponse.json({ error: "lat, lng and destination are required" }, { status: 400 });
  }

  if (lat < 51.2 || lat > 51.8 || lng < -0.7 || lng > 0.5) {
    return NextResponse.json({ error: "Origin must be within the London region" }, { status: 400 });
  }

  const cacheKey = `${lat.toFixed(4)}|${lng.toFixed(4)}|${destinationPostcode.replace(/\s+/g, "")}|${arriveBy}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.value);

  try {
    const payload = await fetchJourney(lat, lng, destinationPostcode, arriveBy, PUBLIC_TRANSPORT_MODES, true);
    const journeys = Array.isArray(payload?.journeys) ? payload.journeys : [];
    const transitJourney = journeys
      .filter(isPublicTransportJourney)
      .sort((a: any, b: any) => Number(a?.duration || Infinity) - Number(b?.duration || Infinity))[0];
    let walkingJourney = journeys
      .filter(isWalkingJourney)
      .sort((a: any, b: any) => Number(a?.duration || Infinity) - Number(b?.duration || Infinity))[0];

    if (!walkingJourney) {
      const walkingPayload = await fetchJourney(lat, lng, destinationPostcode, arriveBy, "walking", false);
      walkingJourney = Array.isArray(walkingPayload?.journeys) ? walkingPayload.journeys[0] : null;
    }

    const value = {
      publicTransport: normaliseJourney(transitJourney),
      walking: normaliseJourney(walkingJourney),
    };
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(value);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commute lookup failed" },
      { status: 502 },
    );
  }
}
