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
    <section className="filterBar" aria-label="Search filters">
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
        <div className="rentInputs">
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

      <div className="filterGroup crimeGroup">
        <label htmlFor="crime">Max reported crime / month</label>
        <span className="filterSubheader">
          {londonCrimeAverage === null
            ? "London area average · loading official data"
            : `London area average · ${londonCrimeAverage} reported crimes / month`}
        </span>
        <select id="crime" value={filters.maxCrime} onChange={(event) => update("maxCrime", Number(event.target.value))}>
          <option value={49}>≤ 49</option>
          <option value={99}>≤ 99</option>
          <option value={199}>≤ 199</option>
          <option value={299}>≤ 299</option>
          <option value={499}>≤ 499</option>
          <option value={9999}>Any</option>
        </select>
      </div>
    </section>
  );
}
