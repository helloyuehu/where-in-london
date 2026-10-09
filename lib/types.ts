export type TravelMode = "publicTransport" | "walking";
export type BedroomOption = "studio" | 1 | 2 | 3 | "4+";

export type RouteLeg = {
  mode: "walk" | "tube" | "bus" | "rail" | "dlr" | "overground" | "tram";
  line?: string;
  minutes: number;
};

export type CommuteOption = {
  minutes: number;
  legs?: RouteLeg[];
};

export type SourceRef = {
  label: string;
  detail: string;
  url?: string;
};

export type LondonArea = {
  id: string;
  name: string;
  borough: string;
  referencePoint: {
    name: string;
    lat: number;
    lng: number;
  };
  commute: {
    publicTransport: CommuteOption;
    walking: CommuteOption;
  };
  crime: {
    month: string;
    total: number;
    radiusMiles: number;
  };
  rentByBedroom: Record<string, number>;
  profile: {
    summary: string;
    tags: string[];
  };
  sources: SourceRef[];
};

export type FilterState = {
  destinationPostcode: string;
  maxCommuteMinutes: number;
  travelModes: TravelMode[];
  arriveBy: string;
  rentMin: number;
  rentMax: number;
  bedroom: BedroomOption;
  maxCrime: number;
};

export type MatchResult = {
  area: LondonArea;
  rent: number | null;
  commuteMatches: boolean;
  rentMatches: boolean;
  crimeMatches: boolean;
  allMatch: boolean;
  failedCriteria: Array<"commute" | "rent" | "crime">;
};
