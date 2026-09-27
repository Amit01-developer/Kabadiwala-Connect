import { useEffect, useState } from "react";
import { ArrowDownToLine, BadgeCheck, Database, Image, ShieldCheck, X } from "lucide-react";
import { api, downloadExport } from "../api";
import { useAuth } from "../auth";
import { Button, EmptyState, ErrorBanner, LoadingState, PageHeading, useToast } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Material } from "../types";

type Sample = { id: string; lot_id: string; lot_code: string; material: Material; validation_state: string; reviewer_note: string; collector_name: string; recycler_name: string; created_at: string; photo_url: string };

export function DataReviewPage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const notify = useToast();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      const result = await api.feedback();
      setSamples(result.samples);
      setError("");
      for (const sample of result.samples) {
        if (!photos[sample.id]) api.photo(sample.photo_url).then((url) => setPhotos((current) => ({ ...current, [sample.id]: url }))).catch(() => undefined);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); return () => Object.values(photos).forEach(URL.revokeObjectURL); }, []);

  async function review(sample: Sample, validation_state: "validated" | "rejected") {
    setBusy(sample.id); setError("");
    try {
      await api.reviewFeedback(sample.id, validation_state, validation_state === "validated" ? "Material label checked against handover." : "Image or material label needs correction.");
      await load();
      notify({ title: t(language, validation_state === "validated" ? "validate" : "rejectSample"), kind: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
    finally { setBusy(""); }
  }

  async function exportImages() {
    try { await downloadExport("/api/admin/feedback/export", "validated-material-images.jsonl"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
  }
  async function exportPrices() {
    try { await downloadExport("/api/admin/price-training/export", "verified-transactions.jsonl"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
  }

  const pending = samples.filter((sample) => sample.validation_state === "pending");
  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={t(language, "navAdmin")} title={t(language, "dataReview")} description={t(language, "fieldData")} />
    <div className="ml-data-banner"><div className="ml-symbol"><Database size={20} /></div><div><strong>{t(language, "collectSamples")}</strong><p>{t(language, "noPhotoModel")}</p><small>{t(language, "safeHandover")} → {t(language, "reviewNeeded")} → {t(language, "dataReview")}</small></div><div className="export-actions"><Button variant="outline" icon={ArrowDownToLine} onClick={() => void exportImages()}>{t(language, "exportDataset")}</Button><Button variant="outline" icon={ArrowDownToLine} onClick={() => void exportPrices()}>{t(language, "exportPrices")}</Button></div></div>
    <div className="section-heading"><div><div className="eyebrow">{t(language, "reviewQueue")}</div><h2>{t(language, "collectSamples")}</h2></div><span className="section-count">{pending.length} {t(language, "pending").toLowerCase()}</span></div>
    {loading ? <LoadingState label={t(language, "loading")} /> : pending.length === 0 ? <EmptyState icon={Image} title={t(language, "noSamples")} detail={t(language, "safeHandover")} /> : <div className="sample-grid">{pending.map((sample) => <article className="sample-card" key={sample.id}>
      {photos[sample.id] ? <img className="sample-photo" src={photos[sample.id]} alt={materialLabel(language, sample.material)} /> : <div className="sample-photo placeholder"><Image size={24} /></div>}
      <div className="sample-card-body"><div className="sample-label-row"><span className="eyebrow">{sample.lot_code}</span><span className="sample-state"><ShieldCheck size={14} />{t(language, "reviewNeeded")}</span></div><h3>{materialLabel(language, sample.material)}</h3><p>{sample.collector_name} · {sample.recycler_name}</p><div className="sample-actions"><Button variant="secondary" icon={BadgeCheck} disabled={busy === sample.id} onClick={() => void review(sample, "validated")}>{t(language, "validate")}</Button><Button variant="quiet" icon={X} disabled={busy === sample.id} onClick={() => void review(sample, "rejected")}>{t(language, "rejectSample")}</Button></div></div>
    </article>)}</div>}
    <div className="notice-banner notice-info"><Database size={18} /><span>Only recycler-confirmed, administrator-validated photos are included in the classifier training export. Training requires enough examples across at least two materials.</span></div>
  </div>;
}
