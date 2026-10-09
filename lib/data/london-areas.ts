import type { LondonArea, RouteLeg } from "@/lib/types";
import { londonAreas as fixtureAreas } from "@/lib/data/areas";
import generated from "@/lib/data/ward-metrics.generated.json";

type GeneratedJourney = {
  minutes: number;
  legs?: RouteLeg[];
} | null;

type GeneratedWard = {
  id: string;
  wardCode: string;
  name: string;
  borough: string;
  referencePoint: { name: string; lat: number; lng: number };
  commute: {
    publicTransport: GeneratedJourney;
    walking: GeneratedJourney;
  };
  crime: {
    month: string;
    total: number;
    radiusMiles: number;
  } | null;
  rentByBedroom: Record<string, number> | null;
  profile: {
    summary: string;
    tags?: string[];
    source?: string;
  } | null;
  complete: boolean;
};

type GeneratedFile = {
  generatedAt: string | null;
  destinationPostcode: string;
  wardCount: number;
  completeCount: number;
  wards: GeneratedWard[];
};

const wardFile = generated as GeneratedFile;

const syncedAreas: LondonArea[] = wardFile.wards
  .filter((ward) => ward.complete && ward.commute.publicTransport && ward.commute.walking && ward.crime && ward.rentByBedroom && ward.profile)
  .map((ward) => ({
    id: ward.id,
    name: ward.name,
    borough: ward.borough,
    referencePoint: ward.referencePoint,
    commute: {
      publicTransport: ward.commute.publicTransport!,
      walking: ward.commute.walking!,
    },
    crime: ward.crime!,
    rentByBedroom: ward.rentByBedroom!,
    profile: {
      summary: ward.profile!.summary,
      tags: ward.profile!.tags ?? [],
    },
    sources: [
      { label: "Greater London Authority", detail: `Official ward geography · ${ward.wardCode}` },
      { label: "data.police.uk", detail: `${ward.crime!.month} · within ${ward.crime!.radiusMiles} mile of ward reference point` },
      { label: "Transport for London", detail: `Journey Planner to ${wardFile.destinationPostcode}` },
      { label: "ONS", detail: `Private rent data mapped from ${ward.borough} local authority` },
      { label: ward.profile!.source ?? "London area profile", detail: "Ward-level profile evidence" },
    ],
  }));

export const londonAreas: LondonArea[] = syncedAreas.length > 0 ? syncedAreas : fixtureAreas;

export const areaDataStatus = {
  source: syncedAreas.length > 0 ? "ward-sync" : "fixtures",
  generatedAt: wardFile.generatedAt,
  totalSyncedWards: wardFile.wardCount,
  completeSyncedWards: wardFile.completeCount,
  activeAreaCount: londonAreas.length,
} as const;
