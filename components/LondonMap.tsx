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

function ringContainsPoint(point: Position, ring: Position[]) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonContainsPoint(point: Position, coordinates: Position[][]) {
  if (!coordinates.length || !ringContainsPoint(point, coordinates[0])) return false;
  return !coordinates.slice(1).some((hole) => ringContainsPoint(point, hole));
}

function geometryContainsPoint(geometry: Geometry, point: Position) {
  if (geometry.type === "Polygon") return polygonContainsPoint(point, (geometry as Polygon).coordinates);
  if (geometry.type === "MultiPolygon") {
    return (geometry as MultiPolygon).coordinates.some((polygon) => polygonContainsPoint(point, polygon));
  }
  return false;
}

function makeAreaPolygonCollection(wards: FeatureCollection<Geometry>, results: MatchResult[]): FeatureCollection<Geometry> {
  const usedWardIndexes = new Set<number>();
  const features: Feature<Geometry>[] = [];

  for (const result of results) {
    const point: Position = [result.area.referencePoint.lng, result.area.referencePoint.lat];
    const wardIndex = wards.features.findIndex((ward, index) => !usedWardIndexes.has(index) && geometryContainsPoint(ward.geometry, point));
    if (wardIndex < 0) continue;

    usedWardIndexes.add(wardIndex);
    const ward = wards.features[wardIndex];
    features.push({
      type: "Feature",
      properties: {
        ...(ward.properties ?? {}),
        id: result.area.id,
        name: result.area.name,
        state: result.allMatch ? "match" : result.failedCriteria.length === 1 ? "near" : "fail",
      },
      geometry: ward.geometry,
    });
  }

  return { type: "FeatureCollection", features };
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
    () => results.map((result) => `${result.area.id}:${result.allMatch}:${result.failedCriteria.length}`).join("|"),
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
    }, 250);

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
      fitBoundsOptions: { padding: 22 },
      maxBounds: LONDON_BOUNDS,
      minZoom: 8.55,
      maxZoom: 15,
      scrollZoom: true,
      dragPan: true,
      doubleClickZoom: true,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-left");

    const fitToLondon = () => {
      map.resize();
      map.fitBounds(LONDON_BOUNDS, { padding: 22, duration: 0 });
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
        map.addSource("london-wards", { type: "geojson", data: data.wards });
        map.addSource("area-polygons", { type: "geojson", data: makeAreaPolygonCollection(data.wards, results) });
        map.addSource("work-location", { type: "geojson", data: makeWorkCollection(workLocationRef.current) });

        map.addLayer({
          id: "london-wards-fill",
          type: "fill",
          source: "london-wards",
          paint: { "fill-color": "#eef1f4", "fill-opacity": 0.78 },
        });
        map.addLayer({
          id: "london-wards-line",
          type: "line",
          source: "london-wards",
          paint: {
            "line-color": "#b8bec6",
            "line-opacity": 0.72,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8.5, 0.55, 12, 1.05],
          },
        });
        map.addLayer({
          id: "london-ward-labels",
          type: "symbol",
          source: "london-wards",
          minzoom: 10.2,
          layout: {
            "text-field": ["get", "ward_name"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 10.2, 9, 13, 12],
            "text-allow-overlap": false,
            "text-padding": 2,
          },
          paint: {
            "text-color": "#737b84",
            "text-halo-color": "rgba(255,255,255,0.92)",
            "text-halo-width": 1.2,
          },
        });
        map.addLayer({
          id: "area-polygons-fill",
          type: "fill",
          source: "area-polygons",
          paint: {
            "fill-color": ["match", ["get", "state"], "match", "#16855b", "near", "#e39a2d", "fail", "#8f98a3", "#8f98a3"],
            "fill-opacity": ["match", ["get", "state"], "match", 0.68, "near", 0.6, "fail", 0.45, 0.45],
          },
        });
        map.addLayer({
          id: "area-polygons-line",
          type: "line",
          source: "area-polygons",
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "id"], selectedId ?? ""],
              "#111111",
              ["match", ["get", "state"], "match", "#0f6b48", "near", "#b96d00", "fail", "#69727c", "#69727c"],
            ],
            "line-width": ["case", ["==", ["get", "id"], selectedId ?? ""], 3.5, 1.7],
            "line-opacity": 1,
          },
        });
        map.addLayer({
          id: "area-polygon-labels",
          type: "symbol",
          source: "area-polygons",
          layout: { "text-field": ["get", "name"], "text-size": 11, "text-allow-overlap": false, "text-padding": 4 },
          paint: { "text-color": "#111111", "text-halo-color": "rgba(255,255,255,0.96)", "text-halo-width": 2 },
        });
        map.addLayer({
          id: "london-boundary-line",
          type: "line",
          source: "london-boundary",
          paint: { "line-color": "#1f2933", "line-opacity": 0.9, "line-width": 2.2 },
        });
        map.addLayer({
          id: "work-pin",
          type: "circle",
          source: "work-location",
          paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": "#111111", "circle-stroke-width": 3 },
        });
        map.addLayer({
          id: "work-label",
          type: "symbol",
          source: "work-location",
          layout: { "text-field": ["concat", "Work · ", ["get", "postcode"]], "text-size": 12, "text-offset": [0, 1.3], "text-anchor": "top" },
          paint: { "text-color": "#111111", "text-halo-color": "#ffffff", "text-halo-width": 2 },
        });

        map.on("mouseenter", "area-polygons-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "area-polygons-fill", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "area-polygons-fill", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelect(id);
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
    const map = mapRef.current;
    const wards = wardsRef.current;
    if (!map || !wards || !map.isStyleLoaded()) return;
    const source = map.getSource("area-polygons") as GeoJSONSource | undefined;
    source?.setData(makeAreaPolygonCollection(wards, results));
  }, [resultSignature, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || !map.getLayer("area-polygons-line")) return;
    map.setPaintProperty("area-polygons-line", "line-color", [
      "case",
      ["==", ["get", "id"], selectedId ?? ""],
      "#111111",
      ["match", ["get", "state"], "match", "#0f6b48", "near", "#b96d00", "fail", "#69727c", "#69727c"],
    ]);
    map.setPaintProperty("area-polygons-line", "line-width", ["case", ["==", ["get", "id"], selectedId ?? ""], 3.5, 1.7]);

    if (!selectedId) return;
    const selected = results.find((result) => result.area.id === selectedId);
    if (!selected) return;
    map.easeTo({ center: [selected.area.referencePoint.lng, selected.area.referencePoint.lat], zoom: Math.max(map.getZoom(), 10.6), duration: 450 });
  }, [selectedId, results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("work-location") as GeoJSONSource | undefined;
    source?.setData(makeWorkCollection(workLocation));
  }, [workLocation]);

  const matches = results.filter((result) => result.allMatch).length;
  const almost = results.filter((result) => !result.allMatch && result.failedCriteria.length === 1).length;
  const noMatch = results.length - matches - almost;

  return (
    <div className="mapShell">
      <div ref={containerRef} className="mapCanvas" aria-label="Greater London map" />

      <div className="mapCoverageBadge">
        <strong>{wardCount ?? "…"} wards shown</strong>
        <span>{results.length} currently evaluated</span>
      </div>

      <div className="mapLegend">
        <span><i className="legendSwatch match" />Match <b>{matches}</b></span>
        <span><i className="legendSwatch near" />Almost <b>{almost}</b></span>
        <span><i className="legendSwatch fail" />Doesn’t match <b>{noMatch}</b></span>
        <span><i className="legendSwatch unevaluated" />Not evaluated</span>
        <span><i className="legendDot work" />Work</span>
      </div>

      <div className="geographyNote">
        {geographyStatus === "ready" && "All official London wards are shown. Coloured wards are areas with complete metrics."}
        {geographyStatus === "loading" && "Loading official London geography…"}
        {geographyStatus === "fallback" && "Official geography unavailable"}
      </div>
    </div>
  );
}
