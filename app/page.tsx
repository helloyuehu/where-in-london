"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type CommutePayload = LondonArea["commute"] & { error?: string };

function normalisePostcode(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

function commuteKey(area: LondonArea, postcode: string, arriveBy: string) {
  return `${area.id}|${normalisePostcode(postcode)}|${arriveBy}`;
}

export default function Home() {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areas, setAreas] = useState<LondonArea[]>([]);
  const [isLoadingAreas, setIsLoadingAreas] = useState(true);
  const [metricsDestinationPostcode, setMetricsDestinationPostcode] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [runtimeCommutes, setRuntimeCommutes] = useState<Record<string, LondonArea["commute"]>>({});
  const [commuteLoadingCount, setCommuteLoadingCount] = useState(0);
  const [commuteErrorCount, setCommuteErrorCount] = useState(0);
  const commuteCacheRef = useRef(new Map<string, LondonArea["commute"]>());

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

  const destinationChanged = Boolean(
    metricsDestinationPostcode
    && normalisePostcode(metricsDestinationPostcode) !== normalisePostcode(filters.destinationPostcode),
  );

  const staticCandidates = useMemo(() => areas.filter((area) => {
    const rent = getRent(area, filters.bedroom);
    if (rent === null || !area.crime) return false;
    const rentPasses = rent >= filters.rentMin && rent <= filters.rentMax;
    const crimePasses = area.crime.total <= filters.maxCrime;
    return rentPasses && crimePasses;
  }), [areas, filters.bedroom, filters.rentMin, filters.rentMax, filters.maxCrime]);

  const staticCandidateSignature = useMemo(
    () => staticCandidates.map((area) => area.id).sort().join("|"),
    [staticCandidates],
  );

  useEffect(() => {
    setRuntimeCommutes({});
    setCommuteErrorCount(0);
  }, [filters.destinationPostcode, filters.arriveBy]);

  useEffect(() => {
    const postcode = filters.destinationPostcode.trim();
    if (!postcode || filters.travelModes.length === 0 || staticCandidates.length === 0) {
      setCommuteLoadingCount(0);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const pending = staticCandidates.filter((area) => {
      const cached = commuteCacheRef.current.get(commuteKey(area, postcode, filters.arriveBy));
      if (cached) return false;
      if (destinationChanged) return true;
      return filters.travelModes.some((mode) => !area.commute[mode]);
    });

    const cachedUpdates: Record<string, LondonArea["commute"]> = {};
    for (const area of staticCandidates) {
      const cached = commuteCacheRef.current.get(commuteKey(area, postcode, filters.arriveBy));
      if (cached) cachedUpdates[area.id] = cached;
    }
    if (Object.keys(cachedUpdates).length) {
      setRuntimeCommutes((current) => ({ ...current, ...cachedUpdates }));
    }

    if (!pending.length) {
      setCommuteLoadingCount(0);
      return () => controller.abort();
    }

    setCommuteLoadingCount(pending.length);
    setCommuteErrorCount(0);
    let cursor = 0;

    const worker = async () => {
      while (!cancelled) {
        const index = cursor++;
        if (index >= pending.length) return;
        const area = pending[index];
        const params = new URLSearchParams({
          lat: String(area.referencePoint.lat),
          lng: String(area.referencePoint.lng),
          destination: postcode,
          arriveBy: filters.arriveBy,
        });

        try {
          const response = await fetch(`/api/commute?${params.toString()}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!response.ok) throw new Error("Commute lookup failed");
          const payload = await response.json() as CommutePayload;
          const commute = {
            publicTransport: payload.publicTransport || null,
            walking: payload.walking || null,
          };
          commuteCacheRef.current.set(commuteKey(area, postcode, filters.arriveBy), commute);
          if (!cancelled) {
            setRuntimeCommutes((current) => ({ ...current, [area.id]: commute }));
          }
        } catch {
          if (!controller.signal.aborted && !cancelled) {
            setCommuteErrorCount((count) => count + 1);
          }
        } finally {
          if (!cancelled) setCommuteLoadingCount((count) => Math.max(0, count - 1));
        }
      }
    };

    void Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    staticCandidateSignature,
    filters.destinationPostcode,
    filters.arriveBy,
    filters.travelModes,
    destinationChanged,
  ]);

  const effectiveAreas = useMemo(() => areas.map((area) => {
    const base = destinationChanged
      ? { ...area, commute: { publicTransport: null, walking: null } }
      : area;
    const runtime = runtimeCommutes[area.id];
    return runtime ? { ...base, commute: runtime } : base;
  }), [areas, destinationChanged, runtimeCommutes]);

  const results = useMemo(
    () => rankResults(effectiveAreas.map((area) => evaluateArea(area, filters))),
    [effectiveAreas, filters],
  );

  const factsReadyCount = areas.filter((area) => area.dataStatus === "ready").length;
  const effectiveById = useMemo(() => new Map(effectiveAreas.map((area) => [area.id, area])), [effectiveAreas]);
  const commuteCheckedCount = staticCandidates.filter((area) => {
    const effective = effectiveById.get(area.id);
    if (!effective) return false;
    return filters.travelModes.every((mode) => Boolean(effective.commute[mode]));
  }).length;

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
          {areas.length ? `${areas.length} representative London areas` : "Representative London areas"} · official ward polygons · no combined score
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
          factsReadyCount={factsReadyCount}
          candidateCount={staticCandidates.length}
          commuteCheckedCount={commuteCheckedCount}
          commuteLoadingCount={commuteLoadingCount}
          commuteErrorCount={commuteErrorCount}
          generatedAt={generatedAt}
        />
      </div>
    </main>
  );
}
