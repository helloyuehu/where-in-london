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
  const [geographyStatus, setGeographyStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [workLocation, setWorkLocation] = useState<WorkLocation | null>(null);

  const resultSignature = useMemo(() => results.map((result) => `${result.area.id}:${result.allMatch}:${result.failedCriteria.length}`).join("|"), [results]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      bounds: LONDON_BOUNDS,
      fitBoundsOptions: { padding: 24 },
      maxBounds: LONDON_BOUNDS,
      minZoom: 8.6,
      maxZoom: 15,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-left");

    map.on("load", async () => {
      try {
        const response = await fetch("/api/geography/london");
        if (!response.ok) throw new Error("Geography unavailable");
        const data = (await response.json()) as GeographyResponse;
        if (!data.boundary || !data.wards) throw new Error("Geography response incomplete");

        wardsRef.current = data.wards;
        map.addSource("london-boundary", { type: "geojson", data: data.boundary });
        map.addSource("london-wards", { type: "geojson", data: data.wards });
        map.addSource("area-polygons", { type: "geojson", data: makeAreaPolygonCollection(data.wards, results) });
        map.addSource("work-location", { type: "geojson", data: makeWorkCollection(null) });

        map.addLayer({
          id: "london-wards-fill",
          type: "fill",
          source: "london-wards",
          paint: { "fill-color": "#ffffff", "fill-opacity": 0.16 },
        });
        map.addLayer({
          id: "london-wards-line",
          type: "line",
          source: "london-wards",
          paint: { "line-color": "#8d8d8d", "line-opacity": 0.3, "line-width": 0.7 },
        });
        map.addLayer({
          id: "area-polygons-fill",
          type: "fill",
          source: "area-polygons",
          paint: {
            "fill-color": [
              "match",
              ["get", "state"],
              "match", "#202020",
              "near", "#9c8f7c",
              "#d7d7d7",
            ],
            "fill-opacity": [
              "match",
              ["get", "state"],
              "match", 0.42,
              "near", 0.3,
              0.16,
            ],
          },
        });
        map.addLayer({
          id: "area-polygons-line",
          type: "line",
          source: "area-polygons",
          paint: {
            "line-color": ["case", ["==", ["get", "id"], selectedId ?? ""], "#111111", "#4c4c4c"],
            "line-width": ["case", ["==", ["get", "id"], selectedId ?? ""], 3, 1.2],
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "area-polygon-labels",
          type: "symbol",
          source: "area-polygons",
          filter: ["!=", ["get", "state"], "fail"],
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-allow-overlap": false,
          },
          paint: {
            "text-color": "#171717",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          },
        });
        map.addLayer({
          id: "london-boundary-line",
          type: "line",
          source: "london-boundary",
          paint: { "line-color": "#222222", "line-opacity": 0.8, "line-width": 2 },
        });
        map.addLayer({
          id: "work-pin",
          type: "circle",
          source: "work-location",
          paint: {
            "circle-radius": 8,
            "circle-color": "#ffffff",
            "circle-stroke-color": "#111111",
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
            "text-offset": [0, 1.3],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#111111",
            "text-halo-color": "#ffffff",
            "text-halo-width": 2,
          },
        });

        map.on("mouseenter", "area-polygons-fill", () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", "area-polygons-fill", () => { map.getCanvas().style.cursor = ""; });
        map.on("click", "area-polygons-fill", (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelect(id);
        });

        map.fitBounds(LONDON_BOUNDS, { padding: 24, duration: 0 });
        setGeographyStatus("ready");
      } catch {
        setGeographyStatus("fallback");
      }
    });

    mapRef.current = map;
    return () => {
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
    map.setPaintProperty("area-polygons-line", "line-color", ["case", ["==", ["get", "id"], selectedId ?? ""], "#111111", "#4c4c4c"]);
    map.setPaintProperty("area-polygons-line", "line-width", ["case", ["==", ["get", "id"], selectedId ?? ""], 3, 1.2]);

    if (!selectedId) return;
    const selected = results.find((result) => result.area.id === selectedId);
    if (!selected) return;
    map.easeTo({ center: [selected.area.referencePoint.lng, selected.area.referencePoint.lat], zoom: Math.max(map.getZoom(), 10.6), duration: 450 });
  }, [selectedId, results]);

  useEffect(() => {
    const postcode = destinationPostcode.trim();
    if (!postcode) {
      setWorkLocation(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/postcode?postcode=${encodeURIComponent(postcode)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Postcode not found");
        const location = (await response.json()) as WorkLocation;
        setWorkLocation(location);
      } catch {
        if (!controller.signal.aborted) setWorkLocation(null);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [destinationPostcode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("work-location") as GeoJSONSource | undefined;
    source?.setData(makeWorkCollection(workLocation));
  }, [workLocation]);

  return (
    <div className="mapShell">
      <div ref={containerRef} className="mapCanvas" aria-label="Greater London map" />
      <div className="mapLegend">
        <span><i className="legendDot match" />Match</span>
        <span><i className="legendDot near" />Almost</span>
        <span><i className="legendDot work" />Work</span>
      </div>
      <div className="geographyNote">
        {geographyStatus === "ready" && "Greater London only · official GLA ward geography"}
        {geographyStatus === "loading" && "Loading official London geography…"}
        {geographyStatus === "fallback" && "Official geography unavailable"}
      </div>
    </div>
  );
}
