"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { MatchResult } from "@/lib/types";

type Props = {
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  destinationPostcode: string;
};

type GeographyResponse = {
  boundary?: FeatureCollection<Geometry>;
  wards?: FeatureCollection<Geometry>;
  error?: string;
};

type WorkLocation = {
  lat: number;
  lng: number;
  postcode: string;
};

const LONDON_BOUNDS: [[number, number], [number, number]] = [
  [-0.53, 51.28],
  [0.34, 51.70],
];

function wardCode(feature: Feature<Geometry>) {
  return String(feature.properties?.ward_code || "");
}

function decorateWards(
  wards: FeatureCollection<Geometry>,
  results: MatchResult[],
): FeatureCollection<Geometry> {
  const byCode = new Map(results.map((result) => [result.area.wardCode, result]));

  return {
    type: "FeatureCollection",
    features: wards.features.map((feature) => {
      const code = wardCode(feature);
      const result = byCode.get(code);
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          id: code,
          name: result?.area.name || feature.properties?.ward_name || code,
          state: result?.state || "context",
          dataStatus: result?.area.dataStatus || "context",
          inModel: Boolean(result),
        },
      };
    }),
  };
}

function makeWorkCollection(location: WorkLocation | null): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: location
      ? [{
          type: "Feature",
          properties: { label: "Work", postcode: location.postcode },
          geometry: { type: "Point", coordinates: [location.lng, location.lat] },
        }]
      : [],
  };
}

export function LondonMap({ results, selectedId, onSelect, destinationPostcode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const wardsRef = useRef<FeatureCollection<Geometry> | null>(null);
  const workLocationRef = useRef<WorkLocation | null>(null);
  const [geographyStatus, setGeographyStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [workLocation, setWorkLocation] = useState<WorkLocation | null>(null);
  const [wardCount, setWardCount] = useState<number | null>(null);

  const resultSignature = useMemo(
    () => results.map((result) => `${result.area.wardCode}:${result.state}`).join("|"),
    [results],
  );

  useEffect(() => {
    const postcode = destinationPostcode.trim();
    if (!postcode) {
      workLocationRef.current = null;
      setWorkLocation(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/postcode?postcode=${encodeURIComponent(postcode)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Postcode not found");
        const location = (await response.json()) as WorkLocation;
        workLocationRef.current = location;
        setWorkLocation(location);

        const map = mapRef.current;
        if (map?.isStyleLoaded()) {
          const source = map.getSource("work-location") as GeoJSONSource | undefined;
          source?.setData(makeWorkCollection(location));
        }
      } catch {
        if (!controller.signal.aborted) {
          workLocationRef.current = null;
          setWorkLocation(null);
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destinationPostcode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const container = containerRef.current;
    const map = new maplibregl.Map({
      container,
      style: "https://demotiles.maplibre.org/style.json",
      bounds: LONDON_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxBounds: LONDON_BOUNDS,
      minZoom: 8.45,
      maxZoom: 16,
      scrollZoom: true,
      dragPan: true,
      doubleClickZoom: true,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    const fitToLondon = () => {
      map.resize();
      map.fitBounds(LONDON_BOUNDS, { padding: 24, duration: 0 });
    };

    map.on("load", async () => {
      try {
        const response = await fetch("/api/geography/london");
        if (!response.ok) throw new Error("Geography unavailable");
        const data = (await response.json()) as GeographyResponse;
        if (!data.boundary || !data.wards) throw new Error("Geography response incomplete");

        wardsRef.current = data.wards;
        setWardCount(data.wards.features.length);

        map.addSource("london-boundary", { type: "geojson", data: data.boundary });
        map.addSource("london-wards", { type: "geojson", data: decorateWards(data.wards, results) });
        map.addSource("work-location", { type: "geojson", data: makeWorkCollection(workLocationRef.current) });

        map.addLayer({
          id: "london-wards-fill",
          type: "fill",
          source: "london-wards",
          paint: {
            "fill-color": [
              "match",
              ["get", "state"],
              "match", "#16855b",
              "near", "#e39a2d",
              "fail", "#8f98a3",
              "pending", "#d9e0e7",
              "context", "#f5f6f7",
              "#f5f6f7",
            ],
            "fill-opacity": [
              "match",
              ["get", "state"],
              "match", 0.82,
              "near", 0.76,
              "fail", 0.68,
              "pending", 0.76,
              "context", 0.42,
              0.42,
            ],
          },
        });

        map.addLayer({
          id: "london-wards-line",
          type: "line",
          source: "london-wards",
          paint: {
            "line-color": [
              "match",
              ["get", "state"],
              "match", "#0c6442",
              "near", "#a96600",
              "fail", "#66717d",
              "pending", "#8d99a6",
              "context", "#d8dde2",
              "#d8dde2",
            ],
            "line-opacity": [
              "case",
              ["boolean", ["get", "inModel"], false],
              0.96,
              0.62,
            ],
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8.4,
              ["case", ["boolean", ["get", "inModel"], false], 1.05, 0.45],
              12,
              ["case", ["boolean", ["get", "inModel"], false], 1.7, 0.8],
            ],
          },
        });

        map.addLayer({
          id: "london-ward-labels",
          type: "symbol",
          source: "london-wards",
          minzoom: 9.35,
          filter: ["==", ["get", "inModel"], true],
          layout: {
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 9.35, 9, 13, 12],
            "text-allow-overlap": false,
            "text-padding": 3,
          },
          paint: {
            "text-color": "#242a30",
            "text-halo-color": "rgba(255,255,255,0.95)",
            "text-halo-width": 1.5,
          },
        });

        map.addLayer({
          id: "selected-ward-line",
          type: "line",
          source: "london-wards",
          filter: ["==", ["get", "id"], selectedId || "__none__"],
          paint: {
            "line-color": "#101214",
            "line-width": 3.5,
            "line-opacity": 1,
          },
        });

        map.addLayer({
          id: "london-boundary-line",
          type: "line",
          source: "london-boundary",
          paint: { "line-color": "#17212b", "line-opacity": 0.95, "line-width": 2.4 },
        });

        map.addLayer({
          id: "work-pin-halo",
          type: "circle",
          source: "work-location",
          paint: {
            "circle-radius": 13,
            "circle-color": "rgba(255,255,255,0.72)",
            "circle-stroke-width": 0,
          },
        });
        map.addLayer({
          id: "work-pin",
          type: "circle",
          source: "work-location",
          paint: {
            "circle-radius": 7,
            "circle-color": "#111111",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
          },
        });
        map.addLayer({
          id: "work-label",
          type: "symbol",
          source: "work-location",
          layout: {
            "text-field": ["concat", "Work · ", ["get", "postcode"]],
            "text-size": 12,
            "text-offset": [0, 1.45],
            "text-anchor": "top",
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#111111",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });

        map.on("mouseenter", "london-wards-fill", (event) => {
          const inModel = Boolean(event.features?.[0]?.properties?.inModel);
          map.getCanvas().style.cursor = inModel ? "pointer" : "";
        });
        map.on("mouseleave", "london-wards-fill", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "london-wards-fill", (event) => {
          const feature = event.features?.[0];
          const id = feature?.properties?.id;
          const inModel = Boolean(feature?.properties?.inModel);
          if (inModel && typeof id === "string" && id) onSelect(id);
        });

        const workSource = map.getSource("work-location") as GeoJSONSource | undefined;
        workSource?.setData(makeWorkCollection(workLocationRef.current));

        window.requestAnimationFrame(fitToLondon);
        setGeographyStatus("ready");
      } catch {
        setGeographyStatus("fallback");
      }
    });

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => map.resize())
      : null;
    resizeObserver?.observe(container);

    const handleWindowResize = () => map.resize();
    window.addEventListener("resize", handleWindowResize);

    mapRef.current = map;
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const wards = wardsRef.current;
    if (!map || !wards || !map.isStyleLoaded()) return;
    const source = map.getSource("london-wards") as GeoJSONSource | undefined;
    source?.setData(decorateWards(wards, results));
  }, [resultSignature, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("selected-ward-line")) return;
    map.setFilter("selected-ward-line", ["==", ["get", "id"], selectedId || "__none__"]);

    if (!selectedId) return;
    const selected = results.find((result) => result.area.id === selectedId);
    if (!selected) return;
    map.easeTo({
      center: [selected.area.referencePoint.lng, selected.area.referencePoint.lat],
      zoom: Math.max(map.getZoom(), 11),
      duration: 420,
    });
  }, [selectedId, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("work-location") as GeoJSONSource | undefined;
    source?.setData(makeWorkCollection(workLocation));
  }, [workLocation]);

  const matches = results.filter((result) => result.state === "match").length;
  const almost = results.filter((result) => result.state === "near").length;
  const noMatch = results.filter((result) => result.state === "fail").length;
  const pending = results.filter((result) => result.state === "pending").length;

  return (
    <div className="mapShell">
      <div ref={containerRef} className="mapCanvas" aria-label="Greater London area map" />

      <div className="mapCoverageBadge">
        <strong>{results.length || "…"} decision areas</strong>
        <span>{wardCount ? `${wardCount} official wards kept as London context` : "Loading London context…"}</span>
      </div>

      <div className="mapLegend">
        <span><i className="legendSwatch match" />Match <b>{matches}</b></span>
        <span><i className="legendSwatch near" />Almost <b>{almost}</b></span>
        <span><i className="legendSwatch fail" />Doesn’t match <b>{noMatch}</b></span>
        {pending > 0 && <span><i className="legendSwatch unevaluated" />Checking <b>{pending}</b></span>}
        <span><i className="legendDot work" />Work</span>
      </div>

      <div className="geographyNote">
        {geographyStatus === "ready" && "Representative neighbourhood-scale areas use official ward polygons. Other London wards stay visible as geographic context."}
        {geographyStatus === "loading" && "Loading Greater London geography…"}
        {geographyStatus === "fallback" && "Official London geography is temporarily unavailable."}
      </div>
    </div>
  );
}
