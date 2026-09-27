import { useEffect } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { Recycler } from "../types";
import { formatMoney } from "./ui";

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, map.getZoom(), { animate: true }); }, [center[0], center[1], map]);
  return null;
}

export function RecyclerMap({ recyclers, origin, selectedId, onSelect, height = 260 }: {
  recyclers: Recycler[];
  origin: [number, number] | null;
  selectedId?: string;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const first = recyclers.find((row) => row.latitude !== null && row.longitude !== null);
  const center: [number, number] = origin || (first && first.latitude !== null && first.longitude !== null ? [first.latitude, first.longitude] : [18.5204, 73.8567]);
  return <div className="map-frame" style={{ height }}>
    <MapContainer center={center} zoom={12} scrollWheelZoom={false} className="recycler-map">
      <Recenter center={center} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {origin && <CircleMarker center={origin} radius={8} pathOptions={{ color: "#fff", weight: 3, fillColor: "#e8753f", fillOpacity: 1 }}><Popup>Your location</Popup></CircleMarker>}
      {recyclers.filter((row) => row.latitude !== null && row.longitude !== null).map((row) => <CircleMarker
        center={[row.latitude!, row.longitude!]} radius={row.id === selectedId ? 11 : 8}
        pathOptions={{ color: "#fff", weight: 2, fillColor: row.id === selectedId ? "#e8753f" : "#287b5c", fillOpacity: 1 }}
        eventHandlers={{ click: () => onSelect?.(row.id) }} key={row.id}>
        <Popup><strong>{row.organization}</strong><br />{formatMoney(row.offer_per_kg)} / kg</Popup>
      </CircleMarker>)}
    </MapContainer>
  </div>;
}
