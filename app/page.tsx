"use client";

import { useMemo, useState } from "react";
import { FilterBar } from "@/components/FilterBar";
import { LondonMap } from "@/components/LondonMap";
import { ResultsPanel } from "@/components/ResultsPanel";
import { londonAreas } from "@/lib/data/areas";
import { evaluateArea, rankResults } from "@/lib/filter";
import type { FilterState } from "@/lib/types";

const initialFilters: FilterState = {
  destinationPostcode: "EC2A 3LT",
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
  const [selectedId, setSelectedId] = useState<string | null>("hoxton");

  const results = useMemo(
    () => rankResults(londonAreas.map((area) => evaluateArea(area, filters))),
    [filters],
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
        <ResultsPanel filters={filters} results={results} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
    </main>
  );
}
