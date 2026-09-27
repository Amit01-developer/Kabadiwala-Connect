import { useEffect, useState } from "react";
import { ArrowRight, BadgeIndianRupee, Boxes, ChartNoAxesCombined, CheckCircle2, Clock3, Leaf, MapPinned, PackageCheck, PackagePlus, Scale, ShieldCheck, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { materialLabel, t } from "../i18n";
import type { DashboardData, Lot } from "../types";
import { Button, EmptyState, ErrorBanner, formatDate, formatMoney, PageHeading, Stat, StatusBadge } from "../components/ui";

function RecentLots({ lots, language }: { lots: Lot[]; language: "en" | "hi" | "mr" }) {
  if (!lots.length) return <EmptyState icon={Boxes} title={t(language, "noActivity")} detail={t(language, "noActivityHint")} action={<Link className="button button-secondary" to="/new-lot">{t(language, "newCollection")}</Link>} />;
  return <div className="recent-list">{lots.map((lot) => <Link className="recent-row" to={`/lots/${lot.id}`} key={lot.id}>
    <span className={`material-mark small material-${lot.material}`}><span>{lot.material.slice(0, 2).toUpperCase()}</span></span>
    <span className="recent-main"><strong>{materialLabel(language, lot.material)} · {lot.weight_kg} kg</strong><small>{lot.lot_code} · {lot.recycler_name || t(language, "recyclerName")}</small></span>
    <span className="recent-date">{formatDate(lot.created_at, language)}</span>
    <StatusBadge status={lot.status} language={language} />
    <ArrowRight size={17} className="row-arrow" />
  </Link>)}</div>;
}

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const language = user?.preferred_language || "en";
  useEffect(() => {
    let live = true;
    const load = () => api.dashboard().then((result) => { if (live) { setData(result); setError(""); } }).catch((reason) => { if (live) setError(reason instanceof Error ? reason.message : t(language, "dashboardError")); });
    void load();
    const refresh = () => void load();
    window.addEventListener("offline-sync", refresh);
    return () => { live = false; window.removeEventListener("offline-sync", refresh); };
  }, [language]);

  if (!user) return null;
  const totals = data?.totals;
  const role = user.role;

  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={role === "admin" ? t(language, "overview") : `${t(language, "welcome")}, ${user.name.split(" ")[0]}`} title={role === "admin" ? t(language, "overview") : role === "recycler" ? t(language, "requests") : t(language, "dashboard")} description={role === "admin" ? t(language, "adminSubtitle") : role === "recycler" ? t(language, "recyclerSubtitle") : t(language, "collectorSubtitle")} action={role === "collector" ? <Link to="/new-lot" className="button button-primary"><PackagePlus size={17} />{t(language, "newCollection")}</Link> : undefined} />

    {role === "admin" ? <AdminOverview /> : <>
      {role === "recycler" && data?.recycler_profile && !data.recycler_profile.verified && <div className="notice-banner notice-warning"><ShieldCheck size={19} /><div><strong>{t(language, "unverifiedPartner")}</strong><span>{t(language, "verificationPending")}</span></div><Link to="/recycler-profile">{t(language, "profile")}<ArrowRight size={15} /></Link></div>}
      <div className="stat-grid">
        <Stat label={t(language, "totalLots")} value={totals?.lots ?? "—"} icon={Boxes} tint="green" />
        <Stat label={t(language, "activeLots")} value={totals?.active ?? "—"} icon={Clock3} tint="orange" />
        <Stat label={role === "collector" ? t(language, "earned") : t(language, "totalPaid")} value={totals ? formatMoney(totals.earnings) : "—"} icon={BadgeIndianRupee} tint="blue" />
        <Stat label={t(language, "weight")} value={totals ? `${totals.weight_kg} kg` : "—"} icon={Scale} tint="purple" />
      </div>
      <ImpactStrip totals={totals} language={language} />

      {role === "collector" && <div className="feature-band"><div className="feature-symbol"><RecycleIcon /></div><div><div className="eyebrow">{t(language, "verifiedPartner")}</div><strong>{t(language, "requestFor")}</strong><p>{t(language, "demoOnly")}</p></div><Link to="/recyclers" className="button button-dark">{t(language, "recyclers")}<ArrowRight size={16} /></Link></div>}
      {role === "recycler" && <div className="quick-actions"><Link to="/lots?status=requested" className="quick-action"><span className="quick-icon tint-orange"><PackageCheck size={20} /></span><span><strong>{t(language, "requests")}</strong><small>{totals?.active ?? 0} {t(language, "activeLots").toLowerCase()}</small></span><ArrowRight size={17} /></Link><Link to="/recycler-profile" className="quick-action"><span className="quick-icon tint-green"><MapPinned size={20} /></span><span><strong>{t(language, "profile")}</strong><small>{data?.recycler_profile?.organization || "Set your service area and rates"}</small></span><ArrowRight size={17} /></Link></div>}

      <section className="section-block">
        <div className="section-heading"><div><div className="eyebrow">{t(language, "recentActivity")}</div><h2>{role === "recycler" ? t(language, "requests") : t(language, "myLots")}</h2></div><Link to="/lots" className="text-link">{t(language, "viewAll")}<ArrowRight size={15} /></Link></div>
        <RecentLots lots={data?.recent_lots || []} language={language} />
      </section>
      <div className="dashboard-footnote"><ShieldCheck size={17} /><span>{t(language, "safetyOne")}</span><Link to="/safety">{t(language, "safety")}<ArrowRight size={14} /></Link></div>
    </>}
  </div>;
}

function ImpactStrip({ totals, language }: { totals: DashboardData["totals"] | undefined; language: "en" | "hi" | "mr" }) {
  return <section className="impact-panel" aria-label={t(language, "environmentalImpact")}>
    <div className="impact-heading"><div><div className="eyebrow">{t(language, "circularEconomy")}</div><strong>{t(language, "responsibleRecycling")}</strong></div><span className="impact-leaf"><Leaf size={19} /></span></div>
    <div className="impact-metrics">
      <div className="impact-metric"><span className="impact-dot impact-social" /><small>{t(language, "socialImpact")}</small><strong>{totals?.formal_handovers ?? "—"}</strong><span>{t(language, "formalHandovers")}</span></div>
      <div className="impact-metric"><span className="impact-dot impact-economic" /><small>{t(language, "economicImpact")}</small><strong>{totals ? formatMoney(totals.earnings) : "—"}</strong><span>{t(language, "directEarnings")}</span></div>
      <div className="impact-metric"><span className="impact-dot impact-environment" /><small>{t(language, "environmentalImpact")}</small><strong>{totals ? `${totals.weight_kg} kg` : "—"}</strong><span>{t(language, "materialReceived")}</span></div>
    </div>
    <div className="impact-tags"><span>{t(language, "fairPricing")}</span><span>{t(language, "recyclingNetwork")}</span><span>{t(language, "safeHandover")}</span></div>
  </section>;
}

function AdminOverview() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const [data, setData] = useState<Awaited<ReturnType<typeof api.analytics>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.analytics().then(setData).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load analytics.")); }, []);
  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  return <>
    <div className="stat-grid">
      <Stat label={t(language, "totalLots")} value={data?.lots_total ?? "—"} icon={Boxes} tint="green" />
      <Stat label={t(language, "weight")} value={data ? `${data.weight_total_kg} kg` : "—"} icon={Scale} tint="orange" />
      <Stat label={t(language, "totalPaid")} value={data ? formatMoney(data.paid_total) : "—"} icon={BadgeIndianRupee} tint="blue" />
      <Stat label={t(language, "recyclerCount")} value={data ? `${data.recyclers_verified}/${data.recyclers_total}` : "—"} icon={ShieldCheck} tint="purple" />
    </div>
    <div className="admin-shortcuts">
      <Link to="/admin/recyclers"><ShieldCheck size={19} /><span><strong>{t(language, "verify")}</strong><small>{data?.recyclers_total ?? 0} {t(language, "recyclerCount").toLowerCase()}</small></span><ArrowRight size={17} /></Link>
      <Link to="/admin/data"><DatabaseIcon /><span><strong>{t(language, "dataReview")}</strong><small>{data?.awaiting_review ?? 0} {t(language, "reviewQueue").toLowerCase()}</small></span><ArrowRight size={17} /></Link>
      <Link to="/admin/anomalies"><TrendingUp size={19} /><span><strong>{t(language, "anomalies")}</strong><small>{t(language, "priceAnomalyHint")}</small></span><ArrowRight size={17} /></Link>
    </div>
    <section className="section-block">
      <div className="section-heading"><div><div className="eyebrow">{t(language, "overview")}</div><h2>{t(language, "materialBreakdown")}</h2></div><span className="section-count">{data?.lots_total ?? 0} {t(language, "totalLots").toLowerCase()}</span></div>
      <div className="material-breakdown">{(data?.by_material || []).map((item) => {
        const max = Math.max(1, ...(data?.by_material.map((part) => part.lots) || [1]));
        return <div className="breakdown-row" key={item.material}><span>{materialLabel(language, item.material)}</span><span className="breakdown-track"><span style={{ width: `${item.lots / max * 100}%` }} /></span><strong>{item.lots}</strong><small>{item.weight_kg} kg</small></div>;
      })}</div>
    </section>
  </>;
}

function RecycleIcon() { return <Leaf size={25} />; }
function DatabaseIcon() { return <ChartNoAxesCombined size={19} />; }
