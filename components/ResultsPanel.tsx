"use client";

import type { FilterState, MatchResult, RouteLeg } from "@/lib/types";

type Props = {
  filters: FilterState;
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  factsReadyCount: number;
  candidateCount: number;
  commuteCheckedCount: number;
  commuteLoadingCount: number;
  commuteErrorCount: number;
  generatedAt: string | null;
};

function routeLabel(leg: RouteLeg) {
  if (leg.mode === "walk") return `Walk ${leg.minutes}m`;
  return `${leg.line ?? leg.mode} ${leg.minutes}m`;
}

function money(value: number | null) {
  return value === null ? "Pending" : `£${value.toLocaleString("en-GB")}`;
}

function statusLabel(result: MatchResult) {
  if (result.state === "match") return "Matches all";
  if (result.state === "near") return `Misses ${result.failedCriteria[0]}`;
  if (result.state === "fail") return `Misses ${result.failedCriteria.length} criteria`;
  if (result.missingCriteria.length === 1 && result.missingCriteria[0] === "commute") return "Checking commute";
  return `Waiting for ${result.missingCriteria.join(", ") || "data"}`;
}

function updatedLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function ResultsPanel({
  filters,
  results,
  selectedId,
  onSelect,
  isLoading,
  factsReadyCount,
  candidateCount,
  commuteCheckedCount,
  commuteLoadingCount,
  commuteErrorCount,
  generatedAt,
}: Props) {
  const matches = results.filter((result) => result.state === "match");
  const nearMatches = results.filter((result) => result.state === "near");
  const nonMatches = results.filter((result) => result.state === "fail");
  const pending = results.filter((result) => result.state === "pending");
  const refreshed = updatedLabel(generatedAt);
  const factsLoading = !isLoading && results.length > 0 && factsReadyCount === 0;

  const heading = isLoading
    ? "Loading London…"
    : factsLoading
      ? "Loading rent + crime…"
      : commuteLoadingCount > 0
        ? `${matches.length} matches · checking commutes`
        : `${matches.length} ${matches.length === 1 ? "area matches" : "areas match"}`;

  return (
    <aside className="resultsPanel">
      <div className="resultsHeader">
        <div>
          <p className="eyebrow">London rental fit</p>
          <h1>{heading}</h1>
          <p className="coverageCopy">
            {results.length > 0
              ? `${results.length} representative areas · ${factsReadyCount} have rent + crime${factsReadyCount > 0 ? ` · ${candidateCount} pass those filters · ${commuteCheckedCount}/${candidateCount} commutes checked` : ""}`
              : "Loading representative London areas…"}
          </p>
          {commuteErrorCount > 0 && (
            <p className="coverageCopy">{commuteErrorCount} commute lookups could not be resolved yet; other results continue loading.</p>
          )}
        </div>
        <span className="demoBadge live">Official boundaries</span>
      </div>

      <div className="summaryChips" aria-label="Active filters">
        <span>≤ {filters.maxCommuteMinutes} min to {filters.destinationPostcode || "work"}</span>
        <span>{filters.travelModes.includes("publicTransport") ? "Transit" : ""}{filters.travelModes.length === 2 ? " + " : ""}{filters.travelModes.includes("walking") ? "Walk" : ""}</span>
        <span>£{filters.rentMin.toLocaleString("en-GB")}–£{filters.rentMax.toLocaleString("en-GB")}</span>
        <span>{String(filters.bedroom) === "studio" ? "Studio" : `${filters.bedroom} bed`}</span>
        <span>≤ {filters.maxCrime === 9999 ? "Any" : filters.maxCrime} crimes / month</span>
        {refreshed && <span>Facts updated {refreshed}</span>}
      </div>

      <div className="resultsList">
        {factsLoading && (
          <div className="emptyState">
            <strong>Area boundaries and profiles are ready</strong>
            <p>Rent and reported-crime facts are refreshing for the smaller 80-area model. Commute is no longer precomputed for every London ward.</p>
          </div>
        )}

        <ResultSection
          title="Matches"
          detail="Meets every active constraint"
          results={matches}
          selectedId={selectedId}
          onSelect={onSelect}
        />

        {!isLoading && !factsLoading && matches.length === 0 && results.length > 0 && pending.length === 0 && (
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
          compact
        />

        <ResultSection
          title="Checking commute"
          detail="Passed rent + crime; TfL commute is calculated only for candidates"
          results={pending}
          selectedId={selectedId}
          onSelect={onSelect}
          compact
        />

        <ResultSection
          title="Doesn’t match"
          detail="Already ruled out by the active constraints"
          results={nonMatches}
          selectedId={selectedId}
          onSelect={onSelect}
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
  compact = false,
}: {
  title: string;
  detail: string;
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
        />
      ))}
    </section>
  );
}

function Metric({
  label,
  passes,
  value,
  detail,
}: {
  label: string;
  passes: boolean | null;
  value: string;
  detail: string;
}) {
  const state = passes === null ? "pending" : passes ? "pass" : "fail";
  const marker = passes === null ? "…" : passes ? "✓" : "✕";
  return (
    <div className={`metric ${state}`}>
      <span>{marker} {label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function AreaCard({
  result,
  selected,
  onSelect,
  compact = false,
}: {
  result: MatchResult;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  const { area } = result;
  const transit = area.commute.publicTransport;
  const walking = area.commute.walking;
  const route = transit?.legs?.map(routeLabel).join(" → ");
  const crime = area.crime;
  const boundary = area.boundaryName && area.boundaryName !== area.name ? ` · ${area.boundaryName} ward` : "";

  return (
    <button type="button" onClick={onSelect} className={`areaCard ${result.state} ${selected ? "selected" : ""}`}>
      <div className="cardTopline">
        <div>
          <h2>{area.name}</h2>
          <p>{area.borough}{boundary}</p>
        </div>
        <span className={`matchPill ${result.state}`}>{statusLabel(result)}</span>
      </div>

      {!compact && <p className="areaSummary">{area.profile.summary}</p>}

      <div className="metricGrid">
        <Metric
          label="Commute"
          passes={result.commuteMatches}
          value={transit ? `${transit.minutes} min` : "Checking"}
          detail={transit ? `transit${walking ? ` · walk ${walking.minutes} min` : ""}` : "TfL Journey Planner · on demand"}
        />
        <Metric
          label="Rent"
          passes={result.rentMatches}
          value={money(result.rent)}
          detail={result.rent === null ? "ONS borough rent by bedroom" : `/ month · ${area.borough}`}
        />
        <Metric
          label="Reported crime"
          passes={result.crimeMatches}
          value={crime ? String(crime.total) : "Pending"}
          detail={crime ? `${crime.month} · within ${crime.radiusMiles} mile` : "Police.uk · one-mile radius"}
        />
      </div>

      {!compact && route && <div className="routeLine"><span className="routeIcon">↳</span><span>{route}</span></div>}

      {!compact && area.profile.tags.length > 0 && (
        <div className="tagRow">
          {area.profile.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}

      {!compact && area.sources.length > 0 && (
        <div className="sourceLine" aria-label="Data sources">
          <span>Sources</span>
          <span>{Array.from(new Set(area.sources.map((source) => source.detail))).join(" · ")}</span>
        </div>
      )}
    </button>
  );
}
