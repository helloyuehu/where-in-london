"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";
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

function geometryCentre(geometry: Geometry) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const lng = value[0];
      const lat = value[1];
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      return;
    }
    value.forEach(visit);
  };

  visit((geometry as Polygon | MultiPolygon).coordinates);
  if (!Number.isFinite(minLng)) return { lng: -0.1276, lat: 51.5072 };
  return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 };
}

function nearestResult(feature: Feature<Geometry>, results: MatchResult[]) {
  if (!results.length) return undefined;
  const centre = geometryCentre(feature.geometry);
  let nearest = results[0];
  let best = Infinity;
  for (const result of results) {
    const dx = (centre.lng - result.area.referencePoint.lng) * 0.63;
    const dy = centre.lat - result.area.referencePoint.lat;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      nearest = result;
    }
  }
  return nearest;
}

function decorateWards(wards: FeatureCollection<Geometry>, results: MatchResult[]): FeatureCollection<Geometry> {
  const byCode = new Map(results.map((result) => [result.area.wardCode, result]));
  return {
    type: "FeatureCollection",
    features: wards.features.map((feature) => {
      const code = wardCode(feature);
      const anchor = byCode.get(code);
      const result = anchor || nearestResult(feature, results);
      return {
        ...feature,
        properties: {
          ...(feature.properties ?? {}),
          id: result?.area.id || code,
          name: result?.area.name || feature.properties?.ward_name || code,
          state: result?.state || "context",
          inModel: Boolean(result),
          isAnchor: Boolean(anchor),
        },
      };
    }),
  };
}

function makeResultLabels(results: MatchResult[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: results
      .filter((result) => result.state === "match" || result.state === "near")
      .map((result) => ({
        type: "Feature",
        properties: {
          id: result.area.id,
          name: result.area.name,
          state: result.state,
        },
        geometry: {
          type: "Point",
          coordinates: [result.area.referencePoint.lng, result.area.referencePoint.lat],
        },
      })),
  };
}

function makeOutsideMask(boundary: FeatureCollection<Geometry>): FeatureCollection<Geometry> {
  const holes: Position[][] = [];
  for (const feature of boundary.features) {
    if (feature.geometry.type === "Polygon") {
      const ring = (feature.geometry as Polygon).coordinates[0];
      if (ring) holes.push([...ring].reverse());
    }
    if (feature.geometry.type === "MultiPolygon") {
      for (const polygon of (feature.geometry as MultiPolygon).coordinates) {
        if (polygon[0]) holes.push([...polygon[0]].reverse());
      }
    }
  }

  const world: Position[] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];

  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [world, ...holes],
      },
    }],
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
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [geographyStatus, setGeographyStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [workLocation, setWorkLocation] = useState<WorkLocation | null>(null);

  const resultSignature = useMemo(
    () => results.map((result) => `${result.area.id}:${result.state}`).join("|"),
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
        const source = mapRef.current?.getSource("work-location") as GeoJSONSource | undefined;
        source?.setData(makeWorkCollection(location));
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
        const currentResults = resultsRef.current;

        map.addSource("london-boundary", { type: "geojson", data: data.boundary });
        map.addSource("london-outside", { type: "geojson", data: makeOutsideMask(data.boundary) });
        map.addSource("london-wards", { type: "geojson", data: decorateWards(data.wards, currentResults) });
        map.addSource("result-labels", { type: "geojson", data: makeResultLabels(currentResults) });
        map.addSource("work-location", { type: "geojson", data: makeWorkCollection(workLocationRef.current) });

        map.addLayer({
          id: "london-outside-mask",
          type: "fill",
          source: "london-outside",
          paint: { "fill-color": "#c9cdd1", "fill-opacity": 0.86 },
        });

        map.addLayer({
          id: "london-wards-fill",
          type: "fill",
          source: "london-wards",
          paint: {
            "fill-color": [
              "match", ["get", "state"],
              "match", "#16855b",
              "near", "#e39a2d",
              "fail", "#8f98a3",
              "pending", "#d9e0e7",
              "#f5f6f7",
            ],
            "fill-opacity": [
              "match", ["get", "state"],
              "match", 0.78,
              "near", 0.70,
              "fail", 0.58,
              "pending", 0.62,
              0.40,
            ],
          },
        });

        map.addLayer({
          id: "london-wards-line",
          type: "line",
          source: "london-wards",
          paint: {
            "line-color": "#ffffff",
            "line-opacity": 0.28,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8.4, 0.35, 12, 0.65],
          },
        });

        map.addLayer({
          id: "result-area-labels",
          type: "symbol",
          source: "result-labels",
          minzoom: 8.45,
          layout: {
            "text-field": ["get", "name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 8.45, 10, 12, 12],
            "text-allow-overlap": false,
            "text-padding": 3,
          },
          paint: {
            "text-color": ["case", ["==", ["get", "state"], "match"], "#0d5139", "#7c4d00"],
            "text-halo-color": "rgba(255,255,255,0.96)",
            "text-halo-width": 2,
          },
        });

        map.addLayer({
          id: "selected-ward-line",
          type: "line",
          source: "london-wards",
          filter: ["==", ["get", "id"], selectedId || "__none__"],
          paint: { "line-color": "#101214", "line-width": 2.6, "line-opacity": 0.95 },
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
          paint: { "circle-radius": 13, "circle-color": "rgba(255,255,255,0.72)", "circle-stroke-width": 0 },
        });
        map.addLayer({
          id: "work-pin",
          type: "circle",
          source: "work-location",
          paint: { "circle-radius": 7, "circle-color": "#111111", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
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
          paint: { "text-color": "#111111", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        });

        map.on("mouseenter", "london-wards-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "london-wards-fill", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "london-wards-fill", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string" && id) onSelect(id);
        });

        const workSource = map.getSource("work-location") as GeoJSONSource | undefined;
        workSource?.setData(makeWorkCollection(workLocationRef.current));
        window.requestAnimationFrame(fitToLondon);
        setGeographyStatus("ready");
      } catch {
        setGeographyStatus("fallback");
      }
    });

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
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
    const frame = window.requestAnimationFrame(() => {
      const map = mapRef.current;
      const wards = wardsRef.current;
      if (!map || !wards) return;

      const wardSource = map.getSource("london-wards") as GeoJSONSource | undefined;
      const labelSource = map.getSource("result-labels") as GeoJSONSource | undefined;
      if (!wardSource || !labelSource) return;

      const latestResults = resultsRef.current;
      wardSource.setData(decorateWards(wards, latestResults));
      labelSource.setData(makeResultLabels(latestResults));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [resultSignature]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("selected-ward-line")) return;
    map.setFilter("selected-ward-line", ["==", ["get", "id"], selectedId || "__none__"]);
    if (!selectedId) return;
    const selected = results.find((result) => result.area.id === selectedId);
    if (!selected) return;
    map.easeTo({
      center: [selected.area.referencePoint.lng, selected.area.referencePoint.lat],
      zoom: Math.max(map.getZoom(), 10.6),
      duration: 350,
    });
  }, [selectedId, results]);

  useEffect(() => {
    const source = mapRef.current?.getSource("work-location") as GeoJSONSource | undefined;
    source?.setData(makeWorkCollection(workLocation));
  }, [workLocation]);

  const matches = results.filter((result) => result.state === "match").length;
  const almost = results.filter((result) => result.state === "near").length;
  const noMatch = results.filter((result) => result.state === "fail").length;

  return (
    <div className="mapShell">
      <div ref={containerRef} className="mapCanvas" aria-label="Greater London area map" />

      <div className="mapLegend">
        <span><i className="legendSwatch match" />Match <b>{matches}</b></span>
        <span><i className="legendSwatch near" />Almost <b>{almost}</b></span>
        <span><i className="legendSwatch fail" />Doesn’t match <b>{noMatch}</b></span>
        <span><i className="legendDot work" />Work</span>
      </div>

      <div className="geographyNote">
        {geographyStatus === "ready" && "Sources · GLA ward geography · ONS private rents · Police.uk reported crime · Postcodes.io. Commute uses a distance-based estimate."}
        {geographyStatus === "loading" && "Loading Greater London geography…"}
        {geographyStatus === "fallback" && "Sources · ONS private rents · Police.uk reported crime · Postcodes.io. Official London geography is temporarily unavailable."}
      </div>
    </div>
  );
}