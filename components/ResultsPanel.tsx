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

function crimeComparison(total: number, average: number) {
  if (!average) return "No London comparison";
  const delta = Math.round(((total - average) / average) * 100);
  if (Math.abs(delta) < 2) return "about London average";
  return `${Math.abs(delta)}% ${delta < 0 ? "below" : "above"} London average`;
}

function resultState(result: MatchResult) {
  if (result.allMatch) return "match";
  if (result.failedCriteria.length === 1) return "near";
  return "fail";
}

function statusLabel(result: MatchResult) {
  if (result.allMatch) return "Matches all";
  if (result.failedCriteria.length === 1) return `Misses ${result.failedCriteria[0]}`;
  return `Misses ${result.failedCriteria.length} criteria`;
}

export function ResultsPanel({ filters, results, selectedId, onSelect }: Props) {
  const matches = results.filter((result) => result.allMatch);
  const nearMatches = results.filter((result) => !result.allMatch && result.failedCriteria.length === 1);
  const nonMatches = results.filter((result) => result.failedCriteria.length >= 2);
  const londonCrimeAverage = results.length
    ? Math.round(results.reduce((sum, result) => sum + result.area.crime.total, 0) / results.length)
    : 0;

  return (
    <aside className="resultsPanel">
      <div className="resultsHeader">
        <div>
          <p className="eyebrow">London rental fit</p>
          <h1>{matches.length} match</h1>
          <p className="coverageCopy">{results.length} demo areas evaluated · all London wards shown on map</p>
        </div>
        <span className="demoBadge">V1 · fixture metrics</span>
      </div>

      <div className="summaryChips" aria-label="Active filters">
        <span>≤ {filters.maxCommuteMinutes} min to {filters.destinationPostcode || "work"}</span>
        <span>{filters.travelModes.includes("publicTransport") ? "Transit" : ""}{filters.travelModes.length === 2 ? " + " : ""}{filters.travelModes.includes("walking") ? "Walk" : ""}</span>
        <span>£{filters.rentMin.toLocaleString("en-GB")}–£{filters.rentMax.toLocaleString("en-GB")}</span>
        <span>{String(filters.bedroom) === "studio" ? "Studio" : `${filters.bedroom} bed`}</span>
        <span>≤ {filters.maxCrime === 9999 ? "Any" : filters.maxCrime} crimes / month</span>
        <span>London demo avg: {londonCrimeAverage} / month</span>
      </div>

      <div className="resultsList">
        <ResultSection
          title="Matches"
          detail="Meets every active constraint"
          results={matches}
          selectedId={selectedId}
          onSelect={onSelect}
          londonCrimeAverage={londonCrimeAverage}
        />

        {matches.length === 0 && (
          <div className="emptyState">
            <strong>No exact matches</strong>
            <p>Try widening one constraint. Almost matches are shown below.</p>
          </div>
        )}

        <ResultSection
          title="Almost matches"
          detail="Misses one criterion"
          results={nearMatches}
          selectedId={selectedId}
          onSelect={onSelect}
          londonCrimeAverage={londonCrimeAverage}
          compact
        />

        <ResultSection
          title="Doesn’t match"
          detail="Misses two or more criteria"
          results={nonMatches}
          selectedId={selectedId}
          onSelect={onSelect}
          londonCrimeAverage={londonCrimeAverage}
          compact
        />
      </div>
    </aside>
  );
}

function ResultSection({
  title,
  detail,
  results,
  selectedId,
  onSelect,
  londonCrimeAverage,
  compact = false,
}: {
  title: string;
  detail: string;
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  londonCrimeAverage: number;
  compact?: boolean;
}) {
  if (!results.length) return null;

  return (
    <section className="resultSection">
      <div className="sectionHeading">
        <span>{title} <b>{results.length}</b></span>
        <small>{detail}</small>
      </div>
      {results.map((result) => (
        <AreaCard
          key={result.area.id}
          result={result}
          selected={selectedId === result.area.id}
          onSelect={() => onSelect(result.area.id)}
          compact={compact}
          londonCrimeAverage={londonCrimeAverage}
        />
      ))}
    </section>
  );
}

function AreaCard({
  result,
  selected,
  onSelect,
  londonCrimeAverage,
  compact = false,
}: {
  result: MatchResult;
  selected: boolean;
  onSelect: () => void;
  londonCrimeAverage: number;
  compact?: boolean;
}) {
  const { area } = result;
  const transit = area.commute.publicTransport;
  const route = transit.legs?.map(routeLabel).join(" → ");
  const state = resultState(result);

  return (
    <button type="button" onClick={onSelect} className={`areaCard ${state} ${selected ? "selected" : ""}`}>
      <div className="cardTopline">
        <div>
          <h2>{area.name}</h2>
          <p>{area.borough}</p>
        </div>
        <span className={`matchPill ${state}`}>{statusLabel(result)}</span>
      </div>

      {!compact && <p className="areaSummary">{area.profile.summary}</p>}

      <div className="metricGrid">
        <div className={`metric ${result.commuteMatches ? "pass" : "fail"}`}>
          <span>{result.commuteMatches ? "✓" : "✕"} Commute</span>
          <strong>{transit.minutes} min</strong>
          <small>transit · walk {area.commute.walking.minutes} min</small>
        </div>
        <div className={`metric ${result.rentMatches ? "pass" : "fail"}`}>
          <span>{result.rentMatches ? "✓" : "✕"} Rent</span>
          <strong>{money(result.rent)}</strong>
          <small>/ month · selected bed</small>
        </div>
        <div className={`metric ${result.crimeMatches ? "pass" : "fail"}`}>
          <span>{result.crimeMatches ? "✓" : "✕"} Reported crime</span>
          <strong>{area.crime.total}</strong>
          <small>{crimeComparison(area.crime.total, londonCrimeAverage)}</small>
        </div>
      </div>

      {!compact && (
        <div className="crimeContext">
          <span>London demo average</span>
          <strong>{londonCrimeAverage} reported crimes / month</strong>
          <small>Same fixture measurement basis as the area cards. This will be replaced by real Police.uk data.</small>
        </div>
      )}

      {!compact && route && <div className="routeLine"><span className="routeIcon">↳</span><span>{route}</span></div>}

      {!compact && (
        <div className="tagRow">
          {area.profile.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
    </button>
  );
}
