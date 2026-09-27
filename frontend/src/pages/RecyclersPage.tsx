import { useEffect, useState } from "react";
import { ArrowRight, LocateFixed, MapPinned, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { RecyclerMap } from "../components/RecyclerMap";
import { Button, ErrorBanner, LoadingState, MaterialTile, PageHeading, formatMoney } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Material, Recycler } from "../types";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];

export function RecyclersPage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const [material, setMaterial] = useState<Material>("mobile");
  const [mode, setMode] = useState<"pickup" | "dropoff">("pickup");
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [recyclers, setRecyclers] = useState<Recycler[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    return api.recyclers(material, location?.[0] ?? null, location?.[1] ?? null, mode)
      .then((result) => { setRecyclers(result.recyclers); setSelectedId((current) => result.recyclers.some((item) => item.id === current) ? current : result.recyclers[0]?.id || ""); setError(""); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : t(language, "requestError")))
      .finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, [material, mode, location]);

  function locate() {
    if (!navigator.geolocation) { setError(t(language, "missingCoordinate")); return; }
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocation([position.coords.latitude, position.coords.longitude]);
      setLoadingLocation(false);
    }, () => { setLoadingLocation(false); setError(t(language, "missingCoordinate")); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  }

  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={t(language, "verifiedPartner")} title={t(language, "recyclers")} description={t(language, "materialGuide")} action={<Button variant="outline" icon={LocateFixed} onClick={locate} disabled={loadingLocation}>{loadingLocation ? t(language, "loading") : t(language, "useLocation")}</Button>} />
    <div className="finder-controls"><div className="material-grid material-grid-compact">{materials.map((item) => <MaterialTile key={item} material={item} language={language} selected={material === item} onClick={() => setMaterial(item)} />)}</div><div className="mode-select compact"><button type="button" className={mode === "pickup" ? "active" : ""} onClick={() => setMode("pickup")}>{t(language, "pickup")}</button><button type="button" className={mode === "dropoff" ? "active" : ""} onClick={() => setMode("dropoff")}>{t(language, "dropoff")}</button></div></div>
    <div className="directory-layout">
      <div className="directory-list"><div className="section-heading"><div><div className="eyebrow">{location ? t(language, "sortNearby") : t(language, "verifiedPartner")}</div><h2>{materialLabel(language, material)}</h2></div><button className="icon-button" aria-label={t(language, "retry")} onClick={() => void load()}><RefreshCw size={17} /></button></div>
        {loading ? <LoadingState label={t(language, "loadingMap")} /> : recyclers.length === 0 ? <div className="notice-banner notice-warning"><ShieldCheck size={18} />{t(language, "noMatchingRecycler")}</div> : <div className="directory-cards">{recyclers.map((item) => <article className={`directory-card ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
          <div className="directory-card-head"><span className="partner-mark"><MapPinned size={19} /></span><div><strong>{item.organization}</strong><small>{item.address || t(language, "noAddress")}</small></div><span className="verified-dot" title={t(language, "verifiedPartner")}><ShieldCheck size={15} /></span></div>
          <div className="directory-card-data"><span>{item.distance_km === null ? "—" : `${item.distance_km} km`}</span><strong>{formatMoney(item.offer_per_kg)} <small>/ kg</small></strong></div>
          <div className="partner-accepts">{item.materials.map((value) => <span key={value}>{materialLabel(language, value)}</span>)}</div>
          {item.maps_url && <a href={item.maps_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{t(language, "direction")}<ArrowRight size={14} /></a>}
        </article>)}</div>}
      </div>
      <aside className="directory-map"><div className="map-title"><div><div className="eyebrow">{t(language, "recyclers")}</div><strong>{recyclers.length} {t(language, "verifiedPartner").toLowerCase()}</strong></div><MapPinned size={18} /></div><RecyclerMap recyclers={recyclers} origin={location} selectedId={selectedId} onSelect={setSelectedId} height={430} /><div className="map-disclaimer">© OpenStreetMap contributors · {t(language, "mapUnavailable")}</div></aside>
    </div>
  </div>;
}
