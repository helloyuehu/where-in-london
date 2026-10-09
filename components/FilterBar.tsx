"use client";

import type { BedroomOption, FilterState, TravelMode } from "@/lib/types";

type Props = {
  filters: FilterState;
  onChange: (next: FilterState) => void;
  londonCrimeAverage: number | null;
};

const bedroomOptions: BedroomOption[] = ["studio", 1, 2, 3, "4+"];

export function FilterBar({ filters, onChange, londonCrimeAverage }: Props) {
  const update = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleTravelMode = (mode: TravelMode) => {
    const has = filters.travelModes.includes(mode);
    update("travelModes", has ? filters.travelModes.filter((item) => item !== mode) : [...filters.travelModes, mode]);
  };

  return (
    <section
      className="filterBar"
      aria-label="Search filters"
      style={{
        gridTemplateColumns: "minmax(125px,.85fr) 86px 138px 92px minmax(188px,1.2fr) 96px minmax(178px,1.05fr)",
        gap: 8,
        overflowX: "hidden",
      }}
    >
      <div className="filterGroup destinationGroup">
        <label htmlFor="postcode">Work postcode</label>
        <div className="inlineInput">
          <span className="pinDot" aria-hidden="true" />
          <input id="postcode" value={filters.destinationPostcode} onChange={(event) => update("destinationPostcode", event.target.value.toUpperCase())} placeholder="W1D 3QW" />
        </div>
      </div>

      <div className="filterGroup compact">
        <label htmlFor="commute">Max commute</label>
        <div className="numberSuffix">
          <input id="commute" type="number" min={5} max={180} value={filters.maxCommuteMinutes} onChange={(event) => update("maxCommuteMinutes", Number(event.target.value) || 5)} />
          <span>min</span>
        </div>
      </div>

      <div className="filterGroup travelModes">
        <span className="fieldLabel">Travel by</span>
        <div className="segmented">
          <button type="button" className={filters.travelModes.includes("publicTransport") ? "active" : ""} onClick={() => toggleTravelMode("publicTransport")}>Transit</button>
          <button type="button" className={filters.travelModes.includes("walking") ? "active" : ""} onClick={() => toggleTravelMode("walking")}>Walk</button>
        </div>
      </div>

      <div className="filterGroup compact">
        <label htmlFor="arrive">Arrive by</label>
        <input id="arrive" type="time" value={filters.arriveBy} onChange={(event) => update("arriveBy", event.target.value)} />
      </div>

      <div className="filterGroup rentGroup">
        <span className="fieldLabel">Monthly rent</span>
        <div className="rentInputs" style={{ gridTemplateColumns: "minmax(68px,1fr) auto minmax(68px,1fr)" }}>
          <div className="numberPrefix"><span>£</span><input aria-label="Minimum rent" type="number" step={50} value={filters.rentMin} onChange={(event) => update("rentMin", Number(event.target.value) || 0)} /></div>
          <span className="rangeDash">to</span>
          <div className="numberPrefix"><span>£</span><input aria-label="Maximum rent" type="number" step={50} value={filters.rentMax} onChange={(event) => update("rentMax", Number(event.target.value) || 0)} /></div>
        </div>
      </div>

      <div className="filterGroup compact">
        <label htmlFor="bedrooms">Bedrooms</label>
        <select id="bedrooms" value={String(filters.bedroom)} onChange={(event) => {
          const value = event.target.value;
          update("bedroom", value === "studio" || value === "4+" ? value : Number(value) as BedroomOption);
        }}>
          {bedroomOptions.map((option) => <option key={String(option)} value={String(option)}>{option === "studio" ? "Studio" : `${option} bed`}</option>)}
        </select>
      </div>

      <div
        className="filterGroup crimeGroup"
        style={{
          background: "#fff8ea",
          border: "1px solid #e4b65f",
          borderRadius: 10,
          padding: "7px 8px 8px",
          margin: "-7px 0 -8px",
        }}
      >
        <label htmlFor="crime" style={{ color: "#8a5700", marginBottom: 4 }}>Reported crime / month</label>
        <span className="filterSubheader" style={{ color: "#9a6a1b", marginBottom: 4 }}>
          {londonCrimeAverage === null
            ? "London area average · loading"
            : `London area average · ${londonCrimeAverage}`}
        </span>
        <select id="crime" value={filters.maxCrime} onChange={(event) => update("maxCrime", Number(event.target.value))}>
          <option value={250}>≤ 250</option>
          <option value={500}>≤ 500</option>
          <option value={1000}>≤ 1,000</option>
          <option value={1500}>≤ 1,500</option>
          <option value={2500}>≤ 2,500</option>
          <option value={9999}>Any</option>
        </select>
      </div>
    </section>
  );
}
