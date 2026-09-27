import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDownRight, ArrowUpRight, BadgeIndianRupee, CircleHelp, RefreshCw } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorBanner, Field, formatDate, formatMoney, LoadingState, MaterialTile, PageHeading, useToast } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Material, Rate } from "../types";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];

export function PricesPage() {
  const { user } = useAuth();
  const notify = useToast();
  const language = user?.preferred_language || "en";
  const [rates, setRates] = useState<Rate[]>([]);
  const [selected, setSelected] = useState<Material>("mobile");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({ rate: "", source: "" });
  const [recyclerOffers, setRecyclerOffers] = useState<Record<string, number> | null>(null);

  async function load() {
    try {
      const result = await api.prices();
      setRates(result.rates);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "requestError"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (user?.role === "recycler") api.recyclerProfile().then((result) => setRecyclerOffers(result.profile.offers)).catch(() => undefined);
  }, [user?.role]);

  const selectedRate = rates.find((rate) => rate.material === selected);
  const chartData = useMemo(() => selectedRate?.history || [], [selectedRate]);

  async function publish(event: FormEvent) {
    event.preventDefault();
    setPublishing(true);
    setError("");
    try {
      await api.publishRate({ material: selected, rate_per_kg: Number(form.rate), source: form.source });
      setForm({ rate: "", source: "" });
      await load();
      notify({ title: t(language, "rateUpdated"), kind: "success" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "requestError"));
    } finally {
      setPublishing(false);
    }
  }

  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={t(language, "transparentPricing")} title={t(language, "currentRates")} description={t(language, "rangeNotice")} action={<button className="icon-button" title={t(language, "retry")} onClick={() => { setLoading(true); void load(); }}><RefreshCw size={17} /></button>} />
    {loading ? <LoadingState label={t(language, "loading")} /> : <>
      <div className="price-board-notice"><CircleHelp size={18} /><span>{rates[0]?.source?.includes("demo") ? t(language, "demoOnly") : t(language, "rangeNotice")}</span><BadgeIndianRupee size={18} /></div>
      <div className="material-grid material-grid-compact">{materials.map((item) => <MaterialTile key={item} material={item} language={language} selected={selected === item} onClick={() => setSelected(item)} />)}</div>
      <div className="price-detail-grid">
        <section className="price-chart-panel">
          <div className="section-heading">
            <div><div className="eyebrow">{t(language, "priceHistory")}</div><h2>{materialLabel(language, selected)}</h2></div>
            <div className={`rate-change ${selectedRate && selectedRate.change_percent >= 0 ? "positive" : "negative"}`}>
              {selectedRate && selectedRate.change_percent >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{selectedRate?.change_percent ?? 0}%
            </div>
          </div>
          <div className="price-big"><strong>{formatMoney(selectedRate?.rate_per_kg || 0)}</strong><span>/ kg | {t(language, "marketRate").toLowerCase()}</span></div>
          <div className="chart-box chart-large">
            {chartData.length > 1 ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ left: 4, right: 14, top: 12, bottom: 0 }}>
              <defs><linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27795a" stopOpacity={0.24} /><stop offset="95%" stopColor="#27795a" stopOpacity={0.01} /></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="#e5ebe5" />
              <XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tickLine={false} axisLine={false} />
              <YAxis width={54} tickFormatter={(value) => `INR ${value}`} tickLine={false} axisLine={false} />
              <Tooltip formatter={(value) => [formatMoney(Number(value)), t(language, "ratePerKg")]} labelFormatter={(value) => formatDate(String(value), language)} />
              <Area type="monotone" dataKey="rate_per_kg" stroke="#27795a" strokeWidth={2.5} fill="url(#priceFill)" activeDot={{ r: 5 }} />
            </AreaChart></ResponsiveContainer> : <div className="chart-empty">{t(language, "noActivityHint")}</div>}
          </div>
          <div className="price-source-row"><span>{t(language, "rateSource")}</span><strong>{selectedRate?.source || "--"}</strong><small>{selectedRate?.updated_at ? formatDate(selectedRate.updated_at, language) : ""}</small></div>
        </section>
        <aside className="price-side-panel">
          {user?.role === "admin" && <section className="detail-panel rate-form-panel"><div className="eyebrow">{t(language, "updateRate")}</div><h2>{t(language, "updateRate")}</h2><form onSubmit={publish}>
            <Field label={t(language, "material")}><select value={selected} onChange={(event) => setSelected(event.target.value as Material)}>{materials.map((item) => <option value={item} key={item}>{materialLabel(language, item)}</option>)}</select></Field>
            <Field label={`${t(language, "ratePerKg")} (INR)`}><input type="number" step="0.01" min="0.01" max="1000000" required value={form.rate} onChange={(event) => setForm({ ...form, rate: event.target.value })} /></Field>
            <Field label={t(language, "rateSource")}><input minLength={2} maxLength={120} required value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="Recycler bulletin or market quote" /></Field>
            <Button type="submit" disabled={publishing}>{publishing ? t(language, "loading") : t(language, "updateRate")}</Button>
          </form></section>}
          {user?.role === "recycler" && <section className="detail-panel"><div className="eyebrow">{t(language, "offer")}</div><h2>{t(language, "quoteFrom")}</h2><p>{t(language, "demoOnly")}</p><div className="offer-rate"><strong>{formatMoney(recyclerOffers?.[selected] || selectedRate?.rate_per_kg || 0)}</strong><span>/ kg</span></div></section>}
          <section className="detail-panel mini-rate-list"><div className="eyebrow">{t(language, "currentRates")}</div>{rates.map((rate) => <button className={selected === rate.material ? "active" : ""} onClick={() => setSelected(rate.material)} key={rate.material}><span>{materialLabel(language, rate.material)}</span><strong>{formatMoney(rate.rate_per_kg)}</strong></button>)}</section>
        </aside>
      </div>
    </>}
  </div>;
}
