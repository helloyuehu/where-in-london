"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, Geometry } from "geojson";
import type { MatchResult } from "@/lib/types";

type Props = {
  results: MatchResult[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

type GeographyResponse = {
  boundary?: FeatureCollection<Geometry>;
  wards?: FeatureCollection<Geometry>;
  error?: string;
};

function makePointCollection(results: MatchResult[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: results.map((result) => ({
      type: "Feature",
      properties: {
        id: result.area.id,
        name: result.area.name,
        state: result.allMatch ? "match" : result.failedCriteria.length === 1 ? "near" : "fail",
      },
      geometry: {
        type: "Point",
        coordinates: [result.area.referencePoint.lng, result.area.referencePoint.lat],
      },
    })),
  };
}

export function LondonMap({ results, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [geographyStatus, setGeographyStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [-0.105, 51.505],
      zoom: 9.2,
      minZoom: 8.2,
      maxZoom: 15,
      attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-left");

    map.on("load", async () => {
      map.addSource("area-points", { type: "geojson", data: makePointCollection(results) });
      map.addLayer({
        id: "area-points-near",
        type: "circle",
        source: "area-points",
        filter: ["==", ["get", "state"], "near"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 7, 12, 12],
          "circle-color": "#9c8f7c",
          "circle-opacity": 0.75,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "area-points-match",
        type: "circle",
        source: "area-points",
        filter: ["==", ["get", "state"], "match"],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8, 12, 13],
          "circle-color": "#191919",
          "circle-opacity": 0.95,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "area-point-labels",
        type: "symbol",
        source: "area-points",
        filter: ["!=", ["get", "state"], "fail"],
        layout: {
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-offset": [0, 1.45],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#242424",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
      map.addLayer({
        id: "selected-area-point",
        type: "circle",
        source: "area-points",
        filter: ["==", ["get", "id"], selectedId ?? ""],
        paint: {
          "circle-radius": 15,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": "#191919",
          "circle-stroke-width": 3,
        },
      });

      for (const layerId of ["area-points-match", "area-points-near"]) {
        map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
        map.on("click", layerId, (event) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelect(id);
        });
      }

      try {
        const response = await fetch("/api/geography/london");
        if (!response.ok) throw new Error("Geography unavailable");
        const data = (await response.json()) as GeographyResponse;
        if (!data.boundary || !data.wards) throw new Error("Geography response incomplete");

        map.addSource("london-boundary", { type: "geojson", data: data.boundary });
        map.addSource("london-wards", { type: "geojson", data: data.wards });
        map.addLayer({
          id: "london-wards-fill",
          type: "fill",
          source: "london-wards",
          paint: { "fill-color": "#ffffff", "fill-opacity": 0.055 },
        }, "area-points-near");
        map.addLayer({
          id: "london-wards-line",
          type: "line",
          source: "london-wards",
          paint: { "line-color": "#777777", "line-opacity": 0.24, "line-width": 0.7 },
        }, "area-points-near");
        map.addLayer({
          id: "london-boundary-line",
          type: "line",
          source: "london-boundary",
          paint: { "line-color": "#303030", "line-opacity": 0.65, "line-width": 1.4 },
        });
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
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource("area-points") as GeoJSONSource | undefined;
    source?.setData(makePointCollection(results));
  }, [results]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    if (map.getLayer("selected-area-point")) {
      map.setFilter("selected-area-point", ["==", ["get", "id"], selectedId ?? ""]);
    }
    if (!selectedId) return;
    const selected = results.find((result) => result.area.id === selectedId);
    if (!selected) return;
    map.easeTo({ center: [selected.area.referencePoint.lng, selected.area.referencePoint.lat], zoom: Math.max(map.getZoom(), 11), duration: 500 });
  }, [selectedId, results]);

  return (
    <div className="mapShell">
      <div ref={containerRef} className="mapCanvas" aria-label="Greater London map" />
      <div className="mapLegend">
        <span><i className="legendDot match" />Match</span>
        <span><i className="legendDot near" />Almost</span>
      </div>
      <div className="geographyNote">
        {geographyStatus === "ready" && "Official GLA boundary + ward geography"}
        {geographyStatus === "loading" && "Loading official London geography…"}
        {geographyStatus === "fallback" && "Official geography unavailable · reference-point fallback"}
      </div>
    </div>
  );
}
