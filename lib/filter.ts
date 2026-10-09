import type { BedroomOption, FilterState, LondonArea, MatchResult, TravelMode } from "@/lib/types";

function bedroomKey(value: BedroomOption): string {
  return String(value);
}

export function getRent(area: LondonArea, bedroom: BedroomOption): number | null {
  return area.rentByBedroom[bedroomKey(bedroom)] ?? null;
}

function modeWithinLimit(area: LondonArea, mode: TravelMode, max: number): boolean {
  return area.commute[mode].minutes <= max;
}

export function evaluateArea(area: LondonArea, filters: FilterState): MatchResult {
  const rent = getRent(area, filters.bedroom);
  const commuteMatches = filters.travelModes.length === 0
    ? true
    : filters.travelModes.some((mode) => modeWithinLimit(area, mode, filters.maxCommuteMinutes));
  const rentMatches = rent !== null && rent >= filters.rentMin && rent <= filters.rentMax;
  const crimeMatches = area.crime.total <= filters.maxCrime;
  const failedCriteria: MatchResult["failedCriteria"] = [];
  if (!commuteMatches) failedCriteria.push("commute");
  if (!rentMatches) failedCriteria.push("rent");
  if (!crimeMatches) failedCriteria.push("crime");

  return {
    area,
    rent,
    commuteMatches,
    rentMatches,
    crimeMatches,
    allMatch: failedCriteria.length === 0,
    failedCriteria,
  };
}

export function rankResults(results: MatchResult[]): MatchResult[] {
  return [...results].sort((a, b) => {
    if (a.allMatch !== b.allMatch) return a.allMatch ? -1 : 1;
    if (a.failedCriteria.length !== b.failedCriteria.length) return a.failedCriteria.length - b.failedCriteria.length;
    return a.area.commute.publicTransport.minutes - b.area.commute.publicTransport.minutes;
  });
}
