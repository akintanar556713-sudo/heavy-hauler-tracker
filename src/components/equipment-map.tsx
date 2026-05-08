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

function makePinIcon(L: typeof LType, status: MapMarker["status"]) {
  const c = colors[status];
  const html = `<div style="position:relative;width:30px;height:40px"><div style="position:absolute;inset:0;background:${c};clip-path:path('M15 0C6.7 0 0 6.7 0 15c0 11 15 25 15 25s15-14 15-25C30 6.7 23.3 0 15 0z');box-shadow:0 2px 6px rgba(0,0,0,.35)"></div><div style="position:absolute;left:9px;top:9px;width:12px;height:12px;border-radius:50%;background:white"></div></div>`;
  return L.divIcon({ html, className: "", iconSize: [30, 40], iconAnchor: [15, 40] });
}

export function EquipmentMap({
  markers,
  onMarkerClick,
  selectedId,
  pickMode,
  onMapClick,
  pickedPoint,
}: {
  markers: MapMarker[];
  onMarkerClick?: (id: string) => void;
  selectedId?: string | null;
  pickMode?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  pickedPoint?: { lat: number; lng: number } | null;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const layerRef = useRef<LType.LayerGroup | null>(null);
  const pickLayerRef = useRef<LType.LayerGroup | null>(null);
  const clickHandlerRef = useRef<((e: LType.LeafletMouseEvent) => void) | null>(null);
  const [L, setL] = useState<typeof LType | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((mod) => { if (!cancelled) setL(mod.default ?? mod); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!L || !elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true }).setView([39.5, -98.35], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    pickLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [L]);

  // Toggle click handler + cursor for pick mode
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    const container = map.getContainer();
    if (clickHandlerRef.current) {
      map.off("click", clickHandlerRef.current);
      clickHandlerRef.current = null;
    }
    container.classList.toggle("picking", !!pickMode);
    if (pickMode && onMapClick) {
      const handler = (e: LType.LeafletMouseEvent) => onMapClick(e.latlng.lat, e.latlng.lng);
      clickHandlerRef.current = handler;
      map.on("click", handler);
    }
    return () => {
      if (clickHandlerRef.current) map.off("click", clickHandlerRef.current);
      clickHandlerRef.current = null;
      container.classList.remove("picking");
    };
  }, [L, pickMode, onMapClick]);

  // Render picked point
  useEffect(() => {
    const layer = pickLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (pickedPoint) {
      L.marker([pickedPoint.lat, pickedPoint.lng], {
        icon: L.divIcon({
          html: `<div style="width:18px;height:18px;border-radius:50%;background:oklch(0.85 0.16 92);border:3px solid oklch(0.22 0.02 250);box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
          className: "", iconSize: [18, 18], iconAnchor: [9, 9],
        }),
      }).addTo(layer);
    }
  }, [L, pickedPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    if (!markers.length) return;
    const bounds: [number, number][] = [];
    markers.forEach((m) => {
      const marker = L.marker([m.lat, m.lng], { icon: makePinIcon(L, m.status) })
        .bindPopup(`<strong>${m.label}</strong>${m.sublabel ? `<br/><span style='color:#666'>${m.sublabel}</span>` : ""}`)
        .on("click", () => onMarkerClick?.(m.id))
        .addTo(layer);
      if (selectedId === m.id) marker.openPopup();
      bounds.push([m.lat, m.lng]);
    });
    if (pickMode) return; // don't auto-fit while picking
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else map.fitBounds(bounds, { padding: [40, 40] });
  }, [L, markers, selectedId, onMarkerClick, pickMode]);

  return <div ref={elRef} className="h-full w-full rounded-lg" />;
}
