"use client";

import type { FilterState, MatchResult, RouteLeg } from "@/lib/types";

type Props = {
  filters: FilterState;
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function routeLabel(leg: RouteLeg) {
  if (leg.mode === "walk") return `Walk ${leg.minutes}m`;
  return `${leg.line ?? leg.mode} ${leg.minutes}m`;
}

function money(value: number | null) {
  return value === null ? "No data" : `£${value.toLocaleString("en-GB")}`;
}

export function ResultsPanel({ filters, results, selectedId, onSelect }: Props) {
  const matches = results.filter((result) => result.allMatch);
  const nearMatches = results.filter((result) => !result.allMatch && result.failedCriteria.length === 1);

  return (
    <aside className="resultsPanel">
      <div className="resultsHeader">
        <div>
          <p className="eyebrow">London rental fit</p>
          <h1>{matches.length} areas match</h1>
        </div>
        <span className="demoBadge">V1 · fixture metrics</span>
      </div>

      <div className="summaryChips" aria-label="Active filters">
        <span>≤ {filters.maxCommuteMinutes} min to {filters.destinationPostcode || "work"}</span>
        <span>{filters.travelModes.includes("publicTransport") ? "Transit" : ""}{filters.travelModes.length === 2 ? " + " : ""}{filters.travelModes.includes("walking") ? "Walk" : ""}</span>
        <span>£{filters.rentMin.toLocaleString("en-GB")}–£{filters.rentMax.toLocaleString("en-GB")}</span>
        <span>{String(filters.bedroom) === "studio" ? "Studio" : `${filters.bedroom} bed`}</span>
        <span>≤ {filters.maxCrime === 9999 ? "Any" : filters.maxCrime} crimes / month</span>
      </div>

      <div className="resultsList">
        {matches.map((result) => (
          <AreaCard key={result.area.id} result={result} selected={selectedId === result.area.id} onSelect={() => onSelect(result.area.id)} />
        ))}

        {matches.length === 0 && (
          <div className="emptyState">
            <strong>No exact matches</strong>
            <p>Try widening one constraint. The closest results are shown below.</p>
          </div>
        )}

        {nearMatches.length > 0 && (
          <div className="nearMatchSection">
            <div className="sectionHeading">
              <span>Almost matches</span>
              <small>Misses one criterion</small>
            </div>
            {nearMatches.slice(0, 6).map((result) => (
              <AreaCard key={result.area.id} result={result} selected={selectedId === result.area.id} onSelect={() => onSelect(result.area.id)} compact />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function AreaCard({ result, selected, onSelect, compact = false }: { result: MatchResult; selected: boolean; onSelect: () => void; compact?: boolean }) {
  const { area } = result;
  const transit = area.commute.publicTransport;
  const route = transit.legs?.map(routeLabel).join(" → ");

  return (
    <button type="button" onClick={onSelect} className={`areaCard ${selected ? "selected" : ""}`}>
      <div className="cardTopline">
        <div>
          <h2>{area.name}</h2>
          <p>{area.borough}</p>
        </div>
        <span className={`matchPill ${result.allMatch ? "match" : "near"}`}>{result.allMatch ? "Matches" : `Misses ${result.failedCriteria[0]}`}</span>
      </div>

      {!compact && <p className="areaSummary">{area.profile.summary}</p>}

      <div className="metricGrid">
        <div className={result.commuteMatches ? "metric" : "metric fail"}>
          <span>Commute</span>
          <strong>{transit.minutes} min</strong>
          <small>transit · walk {area.commute.walking.minutes} min</small>
        </div>
        <div className={result.rentMatches ? "metric" : "metric fail"}>
          <span>Rent</span>
          <strong>{money(result.rent)}</strong>
          <small>/ month · {String(result.area.id) && "selected bed"}</small>
        </div>
        <div className={result.crimeMatches ? "metric" : "metric fail"}>
          <span>Reported crime</span>
          <strong>{area.crime.total}</strong>
          <small>{area.crime.month} · within {area.crime.radiusMiles} mile</small>
        </div>
      </div>

      {!compact && route && <div className="routeLine"><span className="routeIcon">↳</span><span>{route}</span></div>}

      {!compact && (
        <div className="tagRow">
          {area.profile.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
    </button>
  );
}
