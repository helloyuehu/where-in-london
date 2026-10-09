import type { BedroomOption, CommuteOption, SourceRef } from "@/lib/types";

export interface CommuteAdapter {
  getPublicTransport(origin: { lat: number; lng: number }, destinationPostcode: string, arriveBy: string): Promise<CommuteOption | null>;
  getWalking(origin: { lat: number; lng: number }, destinationPostcode: string, arriveBy: string): Promise<CommuteOption | null>;
}

export interface CrimeAdapter {
  getMonthlyCount(origin: { lat: number; lng: number }): Promise<{ total: number; month: string; radiusMiles: number; source: SourceRef } | null>;
}

export interface RentAdapter {
  getMonthlyRent(localAuthority: string, bedroom: BedroomOption): Promise<{ monthly: number; month: string; geography: string; source: SourceRef } | null>;
}

export interface PostcodeAdapter {
  geocode(postcode: string): Promise<{ postcode: string; lat: number; lng: number } | null>;
}
