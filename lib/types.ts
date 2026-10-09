export type TravelMode = "publicTransport" | "walking";
export type BedroomOption = "studio" | 1 | 2 | 3 | "4+";
export type Criterion = "commute" | "rent" | "crime";
export type ResultState = "match" | "near" | "fail" | "pending";

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
  wardCode: string;
  name: string;
  borough: string;
  referencePoint: {
    name: string;
    lat: number;
    lng: number;
  };
  commute: {
    publicTransport: CommuteOption | null;
    walking: CommuteOption | null;
  };
  crime: {
    month: string;
    total: number;
    radiusMiles: number;
  } | null;
  rentByBedroom: Record<string, number> | null;
  profile: {
    summary: string;
    tags: string[];
  };
  sources: SourceRef[];
  dataStatus?: "ready" | "partial" | "pending";
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
  commuteMatches: boolean | null;
  rentMatches: boolean | null;
  crimeMatches: boolean | null;
  allMatch: boolean;
  state: ResultState;
  failedCriteria: Criterion[];
  missingCriteria: Criterion[];
};
