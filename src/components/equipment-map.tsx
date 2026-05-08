import { useEffect, useRef, useState } from "react";
import type * as LType from "leaflet";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  status: "available" | "checked_out" | "maintenance";
};

const colors = {
  available: "oklch(0.65 0.15 145)",
  checked_out: "oklch(0.78 0.16 70)",
  maintenance: "oklch(0.6 0.22 27)",
};

function pinIcon(status: MapMarker["status"]) {
  const c = colors[status];
  const html = `<div style="position:relative;width:30px;height:40px"><div style="position:absolute;inset:0;background:${c};clip-path:path('M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z');box-shadow:0 2px 6px rgba(0,0,0,.35)"></div><div style="position:absolute;left:9px;top:9px;width:12px;height:12px;border-radius:50%;background:white"></div></div>`;
  return L.divIcon({ html, className: "", iconSize: [30, 40], iconAnchor: [15, 40] });
}

export function EquipmentMap({
  markers,
  onMarkerClick,
  selectedId,
}: {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  selectedId?: string | null;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!markers.length) return;
    const bounds: [number, number][] = [];
    markers.forEach((m) => {
      const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.status) })
        .bindPopup(`<strong>${m.label}</strong>${m.sublabel ? `<br/><span style='color:#666'>${m.sublabel}</span>` : ""}`)
        .on("click", () => onMarkerClick?.(m.id))
        .addTo(layer);
      if (selectedId === m.id) marker.openPopup();
      bounds.push([m.lat, m.lng]);
    });
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else map.fitBounds(bounds, { padding: [40, 40] });
  }, [markers, selectedId, onMarkerClick]);

  return <div ref={elRef} className="h-full w-full rounded-lg" />;
}
