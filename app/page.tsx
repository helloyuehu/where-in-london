"use client";

import { useEffect, useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { LondonMap } from "@/components/LondonMap";
import { ResultsPanel } from "@/components/ResultsPanel";
import { londonAreas } from "@/lib/data/areas";
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

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areas, setAreas] = useState<LondonArea[]>(londonAreas);
  const [dataMode, setDataMode] = useState<"demo" | "generated">("demo");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ward-metrics", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.areas) || payload.areas.length === 0) return;
        setAreas(payload.areas as LondonArea[]);
        setDataMode("generated");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const results = useMemo(
    () => rankResults(areas.map((area) => evaluateArea(area, filters))),
    [areas, filters],
  );

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
        <div className="methodNote">Facts first · no combined score</div>
      </header>

      <FilterBar filters={filters} onChange={setFilters} />

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
          dataMode={dataMode}
        />
      </div>
    </main>
  );
}
