import { useEffect, useState } from "react";
import { ArrowRight, Boxes, CircleDollarSign, RefreshCw, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorBanner, formatDate, formatMoney, LoadingState, PageHeading, StatusBadge } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Lot } from "../types";

type Filter = "all" | "open" | "paid";

export function LotsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const language = user?.preferred_language || "en";

  useEffect(() => {
    let active = true;
    const load = () => api.lots().then((result) => {
      if (active) { setLots(result.lots); setError(""); setLoading(false); }
    }).catch((reason) => {
      if (active) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); setLoading(false); }
    });
    void load();
    const refresh = () => void load();
    window.addEventListener("offline-sync", refresh);
    return () => { active = false; window.removeEventListener("offline-sync", refresh); };
  }, [language]);

  useEffect(() => {
    if (params.get("status") === "requested") setFilter("open");
  }, [params]);

  const shown = lots.filter((lot) => {
    const matchesFilter = filter === "all" || (filter === "paid" ? lot.status === "paid" : lot.status !== "paid" && lot.status !== "declined");
    const searchable = `${lot.lot_code} ${lot.material} ${lot.recycler_name || ""} ${lot.status}`.toLowerCase();
    return matchesFilter && searchable.includes(query.toLowerCase());
  });

  return <div className="page-stack">
    <PageHeading eyebrow={user?.role === "recycler" ? t(language, "requests") : t(language, "myLots")} title={user?.role === "recycler" ? t(language, "requests") : t(language, "myLots")} description={user?.role === "recycler" ? t(language, "recyclerSubtitle") : t(language, "timeline")} action={<button className="icon-button" title={t(language, "retry")} onClick={() => { setLoading(true); void api.lots().then((result) => setLots(result.lots)).catch((reason) => setError(reason instanceof Error ? reason.message : "Load failed.")).finally(() => setLoading(false)); }}><RefreshCw size={18} /></button>} />
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <div className="list-toolbar">
      <div className="segment-control list-filters" role="tablist" aria-label={t(language, "status")}>
        {(["all", "open", "paid"] as const).map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{t(language, item === "all" ? "filterAll" : item === "open" ? "filterOpen" : "filterPaid")}</button>)}
      </div>
      <label className="search-field"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(language, "searchMaterial")} /><span className="sr-only">{t(language, "searchMaterial")}</span></label>
    </div>
    {loading ? <LoadingState label={t(language, "loading")} /> : shown.length === 0 ? <EmptyState icon={filter === "paid" ? CircleDollarSign : Boxes} title={t(language, "noLots")} detail={filter === "all" ? t(language, "noActivityHint") : undefined} action={user?.role === "collector" && filter === "all" ? <Link to="/new-lot" className="button button-primary">{t(language, "newCollection")}</Link> : undefined} /> : <div className="lot-list">
      {shown.map((lot) => <Link to={`/lots/${lot.id}`} className="lot-row" key={lot.id}>
        <span className={`material-mark material-${lot.material}`}><span>{lot.material.slice(0, 2).toUpperCase()}</span></span>
        <span className="lot-row-main"><strong>{materialLabel(language, lot.material)} · {lot.weight_kg} kg</strong><small>{lot.lot_code} · {lot.recycler_name || t(language, "recyclerName")}</small></span>
        <span className="lot-row-date"><small>{t(language, "created")}</small>{formatDate(lot.created_at, language)}</span>
        <span className="lot-row-price"><small>{lot.status === "paid" ? t(language, "amountReceived") : t(language, "offer")}</small><strong>{formatMoney(lot.final_price ?? lot.quoted_price ?? lot.estimated_low)}</strong></span>
        <StatusBadge status={lot.status} language={language} /><ArrowRight size={18} className="row-arrow" />
      </Link>)}
    </div>}
    <div className="list-count">{shown.length} / {lots.length}</div>
  </div>;
}
