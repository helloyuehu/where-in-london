"use client";

import { useEffect } from "react";
import { getAreaSummary } from "@/lib/area-summaries";
import type { FilterState, MatchResult } from "@/lib/types";

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

function money(value: number | null) {
  return value === null ? "Pending" : `£${value.toLocaleString("en-GB")}`;
}

function statusLabel(result: MatchResult) {
  if (result.state === "match") return "Matches all";
  if (result.state === "near") return `Misses ${result.failedCriteria[0]}`;
  if (result.state === "fail") return `Misses ${result.failedCriteria.length} criteria`;
  return `Waiting for ${result.missingCriteria.join(", ") || "data"}`;
}

export function ResultsPanel({
  results,
  selectedId,
  onSelect,
  isLoading,
  factsReadyCount,
}: Props) {
  const matches = results.filter((result) => result.state === "match");
  const nearMatches = results.filter((result) => result.state === "near");
  const nonMatches = results.filter((result) => result.state === "fail");
  const pending = results.filter((result) => result.state === "pending");
  const factsLoading = !isLoading && results.length > 0 && factsReadyCount === 0;

  useEffect(() => {
    if (!selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`area-card-${selectedId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  const heading = isLoading
    ? "Loading London…"
    : factsLoading
      ? "Loading rent + crime…"
      : `${matches.length} ${matches.length === 1 ? "area matches" : "areas match"}`;

  return (
    <aside className="resultsPanel">
      <div className="resultsHeader">
        <h1>{heading}</h1>
      </div>

      <div className="resultsList">
        {factsLoading && (
          <div className="emptyState">
            <strong>Area boundaries and profiles are ready</strong>
            <p>Rent and reported-crime facts are still loading.</p>
          </div>
        )}

        <ResultSection
          title="Matches"
          results={matches}
          selectedId={selectedId}
          onSelect={onSelect}
          hideHeading
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
          title="Incomplete data"
          detail="One or more inputs are unavailable"
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
  hideHeading = false,
}: {
  title: string;
  detail?: string;
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
  hideHeading?: boolean;
}) {
  if (!results.length) return null;

  return (
    <section className="resultSection">
      {!hideHeading && (
        <div className="sectionHeading">
          <span>{title} <b>{results.length}</b></span>
          {detail && <small>{detail}</small>}
        </div>
      )}
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
  const crime = area.crime;
  const boundary = area.boundaryName && area.boundaryName !== area.name ? ` · ${area.boundaryName} ward` : "";
  const visibleTags = area.profile.tags.filter((tag) => !tag.trim().toLowerCase().startsWith("private renting"));

  return (
    <button
      id={`area-card-${area.id}`}
      type="button"
      onClick={onSelect}
      className={`areaCard ${result.state} ${selected ? "selected" : ""}`}
    >
      <div className="cardTopline">
        <div>
          <h2>{area.name}</h2>
          <p>{area.borough}{boundary}</p>
        </div>
        <span className={`matchPill ${result.state}`}>{statusLabel(result)}</span>
      </div>

      <p className="areaSummary">{getAreaSummary(area.name, area.borough)}</p>

      <div className="metricGrid">
        <Metric
          label="Commute"
          passes={result.commuteMatches}
          value={transit ? `~${transit.minutes} min` : "Unavailable"}
          detail={transit ? `estimated transit${walking ? ` · walk ~${walking.minutes} min` : ""}` : "distance estimate unavailable"}
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

      {!compact && visibleTags.length > 0 && (
        <div className="tagRow">
          {visibleTags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
    </button>
  );
}
