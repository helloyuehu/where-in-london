"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { LondonMap } from "@/components/LondonMap";
import { ResultsPanel } from "@/components/ResultsPanel";
import { evaluateArea, rankResults } from "@/lib/filter";
import type { FilterState, LondonArea } from "@/lib/types";

const initialFilters: FilterState = {
  destinationPostcode: "W1D 3QW",
  maxCommuteMinutes: 40,
  travelModes: ["publicTransport", "walking"],
  arriveBy: "09:00",
  rentMin: 1500,
  rentMax: 2600,
  bedroom: 1,
  maxCrime: 99,
};

type AreasPayload = {
  areas?: LondonArea[];
  generatedAt?: string | null;
  metricsDestinationPostcode?: string | null;
};

function normalisePostcode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areas, setAreas] = useState<LondonArea[]>([]);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [metricsDestinationPostcode, setMetricsDestinationPostcode] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

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
        setMetricsDestinationPostcode(payload.metricsDestinationPostcode || null);
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

  const effectiveAreas = useMemo(() => {
    const destinationChanged = Boolean(
      metricsDestinationPostcode
      && normalisePostcode(metricsDestinationPostcode) !== normalisePostcode(filters.destinationPostcode),
    );

    if (!destinationChanged) return areas;

    return areas.map((area) => ({
      ...area,
      commute: { publicTransport: null, walking: null },
      dataStatus: area.dataStatus === "ready" ? "partial" as const : area.dataStatus,
    }));
  }, [areas, filters.destinationPostcode, metricsDestinationPostcode]);

  const results = useMemo(
    () => rankResults(effectiveAreas.map((area) => evaluateArea(area, filters))),
    [effectiveAreas, filters],
  );

  const readyCount = effectiveAreas.filter((area) => area.dataStatus === "ready").length;
  const londonCrimeAverage = useMemo(() => {
    const totals = areas.flatMap((area) => area.crime ? [area.crime.total] : []);
    if (!totals.length) return null;
    return Math.round(totals.reduce((sum, total) => sum + total, 0) / totals.length);
  }, [areas]);

  return (
    <main className="appFrame">
      <header className="topBar">
        <div className="brandBlock">
          <div className="brandMark">L</div>
          <div>
            <strong>London Rental Fit</strong>
            <span>Constraint-based area explorer</span>
          </div>
        </div>
        <div className="methodNote">
          {areas.length ? `${areas.length} London areas` : "All London areas"} · official ward boundaries · no combined score
        </div>
      </header>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        londonCrimeAverage={londonCrimeAverage}
      />

      <div className="workspace">
        <LondonMap
          results={results}
          selectedId={selectedId}
          onSelect={setSelectedId}
          destinationPostcode={filters.destinationPostcode}
        />
        <ResultsPanel
          filters={filters}
          results={results}
          selectedId={selectedId}
          onSelect={setSelectedId}
          isLoading={isLoadingAreas}
          readyCount={readyCount}
          generatedAt={generatedAt}
        />
      </div>
    </main>
  );
}
