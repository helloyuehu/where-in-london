"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { LondonMap } from "@/components/LondonMap";
import { ResultsPanel } from "@/components/ResultsPanel";
import { evaluateArea, getRent, rankResults } from "@/lib/filter";
import type { FilterState, LondonArea } from "@/lib/types";

const initialFilters: FilterState = {
  destinationPostcode: "W1D 3QW",
  maxCommuteMinutes: 40,
  travelModes: ["publicTransport", "walking"],
  arriveBy: "09:00",
  rentMin: 500,
  rentMax: 2600,
  bedroom: 1,
  maxCrime: 1000,
};

type AreasPayload = {
  areas?: LondonArea[];
  generatedAt?: string | null;
};

type DestinationPoint = {
  lat: number;
  lng: number;
};

const DEFAULT_WORK_POINT: DestinationPoint = { lat: 51.5136, lng: -0.1311 };

function haversineKm(a: DestinationPoint, b: DestinationPoint) {
  const radiusKm = 6371;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(h));
}

function estimatedCommute(area: LondonArea, destination: DestinationPoint): LondonArea["commute"] {
  const origin = { lat: area.referencePoint.lat, lng: area.referencePoint.lng };
  const directKm = haversineKm(origin, destination);
  const transitKm = directKm * 1.25;
  const walkingKm = directKm * 1.12;

  return {
    publicTransport: {
      minutes: Math.max(8, Math.round(8 + (transitKm / 24) * 60)),
    },
    walking: {
      minutes: Math.max(1, Math.round((walkingKm / 4.8) * 60)),
    },
  };
}

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areas, setAreas] = useState<LondonArea[]>([]);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [destinationPoint, setDestinationPoint] = useState<DestinationPoint>(DEFAULT_WORK_POINT);

  const handleSelect = (id: string) => {
    setSelectedId((current) => current === id ? null : id);
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoadingAreas(true);

    fetch("/api/areas", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("London area data unavailable");
        return response.json() as Promise<AreasPayload>;
      })
      .then((payload) => {
        if (cancelled) return;
        setAreas(Array.isArray(payload.areas) ? payload.areas : []);
        setGeneratedAt(payload.generatedAt || null);
      })
      .catch(() => {
        if (!cancelled) setAreas([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAreas(false);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const postcode = filters.destinationPostcode.trim();
    if (!postcode) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/postcode?postcode=${encodeURIComponent(postcode)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Postcode lookup failed");
        const payload = await response.json() as { lat: number; lng: number };
        if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
          setDestinationPoint({ lat: payload.lat, lng: payload.lng });
        }
      } catch {
        if (!controller.signal.aborted && postcode.replace(/\s+/g, "").toUpperCase() === "W1D3QW") {
          setDestinationPoint(DEFAULT_WORK_POINT);
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters.destinationPostcode]);

  const effectiveAreas = useMemo(
    () => areas.map((area) => ({
      ...area,
      commute: estimatedCommute(area, destinationPoint),
    })),
    [areas, destinationPoint],
  );

  const results = useMemo(
    () => rankResults(effectiveAreas.map((area) => evaluateArea(area, filters))),
    [effectiveAreas, filters],
  );

  const staticCandidates = useMemo(() => effectiveAreas.filter((area) => {
    const rent = getRent(area, filters.bedroom);
    if (rent === null || !area.crime) return false;
    return rent >= filters.rentMin
      && rent <= filters.rentMax
      && area.crime.total <= filters.maxCrime;
  }), [effectiveAreas, filters.bedroom, filters.rentMin, filters.rentMax, filters.maxCrime]);

  const factsReadyCount = areas.filter((area) => area.crime && area.rentByBedroom).length;
  const commuteCheckedCount = staticCandidates.length;

  const londonCrimeAverage = useMemo(() => {
    const totals = areas.flatMap((area) => area.crime ? [area.crime.total] : []);
    if (!totals.length) return null;
    return Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length);
  }, [areas]);

  return (
    <main className="appFrame">
      <header className="topBar">
        <div className="brandBlock">
          <div className="brandMark">W</div>
          <div>
            <strong>Where in London?</strong>
            <span>Find areas that fit your priorities.</span>
          </div>
        </div>
        <div className="methodNote">
          {areas.length ? `${areas.length} London living areas` : "London living areas"} · full-city coverage · instant commute estimate
        </div>
      </header>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        londonCrimeAverage={londonCrimeAverage}
      />

      <div className="workspace">
        {areas.length > 0 ? (
          <LondonMap
            results={results}
            selectedId={selectedId}
            onSelect={handleSelect}
            destinationPostcode={filters.destinationPostcode}
          />
        ) : (
          <div className="mapShell" aria-label="Loading Greater London map" />
        )}
        <ResultsPanel
          filters={filters}
          results={results}
          selectedId={selectedId}
          onSelect={handleSelect}
          isLoading={isLoadingAreas}
          factsReadyCount={factsReadyCount}
          candidateCount={staticCandidates.length}
          commuteCheckedCount={commuteCheckedCount}
          commuteLoadingCount={0}
          commuteErrorCount={0}
          generatedAt={generatedAt}
        />
      </div>
    </main>
  );
}
