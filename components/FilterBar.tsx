"use client";

import { useState } from "react";
import type { BedroomOption, FilterState, TravelMode } from "@/lib/types";

type Props = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  postcodeValue: string;
  onPostcodeChange: (value: string) => void;
  onPostcodeApply: () => void;
  postcodeDirty: boolean;
  postcodeUpdating: boolean;
  londonCrimeAverage: number | null;
};

const bedroomOptions: BedroomOption[] = [1, 2, 3, "4+"];

export function FilterBar({
  filters,
  onChange,
  postcodeValue,
  onPostcodeChange,
  onPostcodeApply,
  postcodeDirty,
  postcodeUpdating,
  londonCrimeAverage,
}: Props) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleTravelMode = (mode: TravelMode) => {
    const has = filters.travelModes.includes(mode);
    update("travelModes", has ? filters.travelModes.filter((item) => item !== mode) : [...filters.travelModes, mode]);
  };

  return (
    <div className={`filterShell${mobileExpanded ? " filtersExpanded" : ""}`}>
      <button
        type="button"
        className="filterMobileToggle"
        onClick={() => setMobileExpanded((expanded) => !expanded)}
        aria-expanded={mobileExpanded}
      >
        <span className="filterMobileTitle">Filters</span>
        <span className="filterMobileSummary">
          {postcodeValue || "Postcode"} · £{filters.rentMin.toLocaleString()}–£{filters.rentMax.toLocaleString()} · {filters.bedroom} bed
        </span>
        <span className="filterMobileChevron" aria-hidden="true">{mobileExpanded ? "▲" : "▼"}</span>
      </button>

      <section
        className="filterBar"
        aria-label="Search filters"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          overflowX: "hidden",
          minWidth: 0,
          alignItems: "flex-end",
        }}
      >
        <div className="filterGroup destinationGroup" style={{ flex: "1 1 150px", minWidth: 140 }}>
          <label htmlFor="postcode">Work postcode</label>
          <div className={`inlineInput${postcodeDirty ? " hasPostcodeAction" : ""}`}>
            <span className="pinDot" aria-hidden="true" />
            <input
              id="postcode"
              value={postcodeValue}
              onChange={(event) => onPostcodeChange(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter" && postcodeDirty && !postcodeUpdating) onPostcodeApply();
              }}
              placeholder="W1D 3QW"
            />
            {postcodeDirty && (
              <button
                type="button"
                className="postcodeUpdateButton"
                onClick={onPostcodeApply}
                disabled={postcodeUpdating || !postcodeValue.trim()}
              >
                <svg className="postcodeUpdateIcon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M13.25 4.75V1.75m0 3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M13.02 4.15A5.75 5.75 0 1 0 13.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                {postcodeUpdating ? "Updating" : "Update"}
              </button>
            )}
          </div>
        </div>

        <div className="filterGroup compact" style={{ flex: "0 1 104px", minWidth: 96 }}>
          <label htmlFor="commute" style={{ whiteSpace: "nowrap" }}>Max commute</label>
          <div className="numberSuffix">
            <input id="commute" type="number" min={5} max={180} value={filters.maxCommuteMinutes} onChange={(event) => update("maxCommuteMinutes", Number(event.target.value) || 5)} />
            <span>min</span>
          </div>
        </div>

        <div className="filterGroup travelModes" style={{ flex: "0 1 124px", minWidth: 118 }}>
          <span className="fieldLabel">Travel by</span>
          <div className="segmented">
            <button type="button" className={filters.travelModes.includes("publicTransport") ? "active" : ""} onClick={() => toggleTravelMode("publicTransport")}>Transit</button>
            <button type="button" className={filters.travelModes.includes("walking") ? "active" : ""} onClick={() => toggleTravelMode("walking")}>Walk</button>
          </div>
        </div>

        <div className="filterGroup compact" style={{ flex: "0 1 116px", minWidth: 110 }}>
          <label htmlFor="arrive">Arrive by</label>
          <input
            id="arrive"
            type="time"
            value={filters.arriveBy}
            onChange={(event) => update("arriveBy", event.target.value)}
            style={{ minWidth: 0, width: "100%", paddingLeft: 8, paddingRight: 8 }}
          />
        </div>

        <div className="filterGroup rentGroup" style={{ flex: "1.35 1 220px", minWidth: 210 }}>
          <span className="fieldLabel">Monthly rent</span>
          <div className="rentInputs" style={{ gridTemplateColumns: "minmax(74px,1fr) auto minmax(74px,1fr)" }}>
            <div className="numberPrefix"><span>£</span><input aria-label="Minimum rent" type="number" step={50} value={filters.rentMin} onChange={(event) => update("rentMin", Number(event.target.value) || 0)} /></div>
            <span className="rangeDash">to</span>
            <div className="numberPrefix"><span>£</span><input aria-label="Maximum rent" type="number" step={50} value={filters.rentMax} onChange={(event) => update("rentMax", Number(event.target.value) || 0)} /></div>
          </div>
        </div>

        <div className="filterGroup compact" style={{ flex: "0 1 104px", minWidth: 100 }}>
          <label htmlFor="bedrooms">Bedrooms</label>
          <select id="bedrooms" value={String(filters.bedroom)} onChange={(event) => {
            const value = event.target.value;
            update("bedroom", value === "4+" ? value : Number(value) as BedroomOption);
          }}>
            {bedroomOptions.map((option) => <option key={String(option)} value={String(option)}>{`${option} bed`}</option>)}
          </select>
        </div>

        <div
          className="filterGroup crimeGroup"
          style={{
            flex: "1.25 1 230px",
            minWidth: 220,
            background: "#eef6ff",
            border: "1px solid #8bb8e8",
            borderRadius: 10,
            padding: "7px 8px 8px",
            margin: 0,
          }}
        >
          <label htmlFor="crime" style={{ color: "#165a9d", marginBottom: 4, whiteSpace: "nowrap" }}>Reported crime / month</label>
          <span className="filterSubheader" style={{ color: "#3976ad", marginBottom: 4 }}>
            {londonCrimeAverage === null
              ? "London area average · loading"
              : `London area average · ${londonCrimeAverage}`}
          </span>
          <select id="crime" value={filters.maxCrime} onChange={(event) => update("maxCrime", Number(event.target.value))}>
            <option value={250}>≤ 250 · Very low</option>
            <option value={500}>≤ 500 · Low</option>
            <option value={1000}>≤ 1,000 · Average</option>
            <option value={1500}>≤ 1,500 · High</option>
            <option value={2500}>≤ 2,500 · Very high</option>
            <option value={9999}>Any · No limit</option>
          </select>
        </div>
      </section>

      <style jsx global>{`
        .filterShell {
          background: #fff;
          border-bottom: 1px solid var(--border);
        }
        .filterShell .filterBar {
          border-bottom: 0;
          overflow-y: visible;
        }
        .inlineInput.hasPostcodeAction input {
          padding-right: 88px;
        }
        .postcodeUpdateButton {
          position: absolute;
          right: 4px;
          top: 4px;
          height: 30px;
          min-width: 74px;
          padding: 0 9px;
          border: 0;
          border-radius: 7px;
          background: #181818;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        .postcodeUpdateIcon {
          width: 12px;
          height: 12px;
          flex: 0 0 auto;
        }
        .postcodeUpdateButton:disabled {
          opacity: .55;
          cursor: default;
        }
        .filterMobileToggle {
          display: none;
        }
        @media (max-width: 820px) {
          .filterMobileToggle {
            width: 100%;
            min-height: 48px;
            display: grid;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
            gap: 10px;
            padding: 0 14px;
            border: 0;
            background: #fff;
            text-align: left;
          }
          .filterMobileTitle {
            font-size: 12px;
            font-weight: 700;
            white-space: nowrap;
          }
          .filterMobileSummary {
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--muted);
            font-size: 10px;
          }
          .filterMobileChevron {
            color: var(--muted);
            font-size: 9px;
          }
          .filterShell:not(.filtersExpanded) .filterBar {
            display: none !important;
          }
          .filterShell.filtersExpanded .filterBar {
            display: flex !important;
            max-height: 44dvh;
            overflow-y: auto !important;
            padding: 12px 14px;
            border-top: 1px solid var(--border);
          }
          .filterShell.filtersExpanded .filterBar > .filterGroup {
            flex: 1 0 100% !important;
            min-width: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}
