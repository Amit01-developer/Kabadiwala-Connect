import { useEffect, useState } from "react";
import { Activity, ArrowRight, CircleDollarSign, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorBanner, formatDate, formatMoney, LoadingState, PageHeading, StatusBadge } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Lot } from "../types";

export function AnomaliesPage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { api.anomalies().then((result) => setLots(result.lots)).catch((reason) => setError(reason instanceof Error ? reason.message : t(language, "requestError"))).finally(() => setLoading(false)); }, []);
  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={t(language, "navAdmin")} title={t(language, "anomalyTitle")} description={t(language, "priceAnomalyHint")} />
    {loading ? <LoadingState label={t(language, "loading")} /> : lots.length === 0 ? <EmptyState icon={Activity} title={t(language, "noAnomalies")} detail={t(language, "noPriceAnomalyHint")} /> : <div className="lot-list">{lots.map((lot) => <Link to={`/lots/${lot.id}`} className="lot-row anomaly-row" key={lot.id}>
      <span className="anomaly-icon"><ShieldAlert size={20} /></span><span className="lot-row-main"><strong>{materialLabel(language, lot.material)} · {lot.weight_kg} kg</strong><small>{lot.lot_code} · {lot.recycler_name}</small></span><span className="lot-row-date"><small>{t(language, "created")}</small>{formatDate(lot.updated_at, language)}</span><span className="lot-row-price"><small>{t(language, "amountReceived")}</small><strong>{formatMoney(lot.final_price || 0)}</strong></span><StatusBadge status={lot.status} language={language} /><ArrowRight size={18} />
    </Link>)}</div>}
  </div>;
}
