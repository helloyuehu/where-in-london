import type { BedroomOption, Criterion, FilterState, LondonArea, MatchResult, TravelMode } from "@/lib/types";

function bedroomKey(value: BedroomOption): string {
  return String(value);
}

export function getRent(area: LondonArea, bedroom: BedroomOption): number | null {
  if (!area.rentByBedroom) return null;
  return area.rentByBedroom[bedroomKey(bedroom)] ?? null;
}

function modeWithinLimit(area: LondonArea, mode: TravelMode, max: number): boolean | null {
  const option = area.commute[mode];
  if (!option) return null;
  return option.minutes <= max;
}

export function evaluateArea(area: LondonArea, filters: FilterState): MatchResult {
  const rent = getRent(area, filters.bedroom);

  let commuteMatches: boolean | null;
  if (filters.travelModes.length === 0) {
    commuteMatches = true;
  } else {
    const modeResults = filters.travelModes.map((mode) => modeWithinLimit(area, mode, filters.maxCommuteMinutes));
    if (modeResults.some((value) => value === true)) commuteMatches = true;
    else if (modeResults.every((value) => value === false)) commuteMatches = false;
    else commuteMatches = null;
  }

  const rentMatches = rent === null ? null : rent >= filters.rentMin && rent <= filters.rentMax;
  const crimeMatches = area.crime === null ? null : area.crime.total <= filters.maxCrime;

  const checks: Array<[Criterion, boolean | null]> = [
    ["commute", commuteMatches],
    ["rent", rentMatches],
    ["crime", crimeMatches],
  ];
  const failedCriteria = checks.filter(([, value]) => value === false).map(([criterion]) => criterion);
  const missingCriteria = checks.filter(([, value]) => value === null).map(([criterion]) => criterion);
  const allMatch = missingCriteria.length === 0 && failedCriteria.length === 0;
  const state = missingCriteria.length > 0
    ? "pending"
    : allMatch
      ? "match"
      : failedCriteria.length === 1
        ? "near"
        : "fail";

  return {
    area,
    rent,
    commuteMatches,
    rentMatches,
    crimeMatches,
    allMatch,
    state,
    failedCriteria,
    missingCriteria,
  };
}

export function rankResults(results: MatchResult[]): MatchResult[] {
  const stateOrder = { match: 0, near: 1, fail: 2, pending: 3 } as const;
  return [...results].sort((a, b) => {
    if (stateOrder[a.state] !== stateOrder[b.state]) return stateOrder[a.state] - stateOrder[b.state];
    if (a.failedCriteria.length !== b.failedCriteria.length) return a.failedCriteria.length - b.failedCriteria.length;
    const aMinutes = a.area.commute.publicTransport?.minutes ?? Number.POSITIVE_INFINITY;
    const bMinutes = b.area.commute.publicTransport?.minutes ?? Number.POSITIVE_INFINITY;
    if (aMinutes !== bMinutes) return aMinutes - bMinutes;
    return a.area.name.localeCompare(b.area.name, "en-GB");
  });
}
