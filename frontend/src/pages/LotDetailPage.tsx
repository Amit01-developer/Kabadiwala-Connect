import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, BadgeCheck, CalendarClock, Check, CircleDollarSign, Clock3, Download, MapPin, PackageCheck, QrCode, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { QRScanner } from "../components/QRScanner";
import { Button, ErrorBanner, Field, formatDate, formatMoney, LoadingState, PageHeading, StatusBadge, useToast } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Condition, Lot, Material } from "../types";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];
const conditions: Condition[] = ["excellent", "good", "fair", "poor"];

export function LotDetailPage() {
  const { lotId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const language = user?.preferred_language || "en";
  const [lot, setLot] = useState<Lot | null>(null);
  const [photo, setPhoto] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qrValue, setQrValue] = useState("");
  const [confirmedMaterial, setConfirmedMaterial] = useState<Material>("mobile");
  const [handoverNote, setHandoverNote] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [paymentReference, setPaymentReference] = useState("");
  const [mode, setMode] = useState<"pickup" | "dropoff">("pickup");
  const [scheduleValue, setScheduleValue] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (lotId.startsWith("offline-")) {
        const collection = await api.lots();
        const draft = collection.lots.find((item) => item.id === lotId);
        if (!draft) throw new Error("This offline request is not saved on this device.");
        setLot(draft);
      } else setLot(await api.lot(lotId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t(language, "requestError"));
    } finally { setLoading(false); }
  }, [lotId, language]);

  useEffect(() => { void reload(); const listener = () => void reload(); window.addEventListener("offline-sync", listener); return () => window.removeEventListener("offline-sync", listener); }, [reload]);

  useEffect(() => {
    let current: string | undefined;
    if (lot?.photo_url && !lot.id.startsWith("offline-")) {
      api.photo(lot.photo_url).then((url) => { current = url; setPhoto(url); }).catch(() => setPhoto(""));
    }
    return () => { if (current) URL.revokeObjectURL(current); };
  }, [lot?.photo_url, lot?.id]);

  useEffect(() => {
    if (!lot) return;
    setConfirmedMaterial(lot.material);
    setPaymentAmount(String(lot.quoted_price ?? lot.estimated_low));
    setMode(lot.collection_mode);
    if (lot.scheduled_at) {
      const date = new Date(lot.scheduled_at);
      setScheduleValue(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    }
  }, [lot?.id]);

  async function act(task: () => Promise<unknown>, success?: string) {
    setBusy(true); setError("");
    try { await task(); await reload(); if (success) notify({ title: success, kind: "success" }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
    finally { setBusy(false); }
  }

  async function submitHandover(event: React.FormEvent) {
    event.preventDefault();
    if (!lot) return;
    await act(() => api.handover(lot.id, {
      lot_code: qrValue.trim(), confirmed_material: confirmedMaterial, note: handoverNote,
      idempotency_key: crypto.randomUUID(),
    }), t(language, "safeHandover"));
  }

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!lot || Number(paymentAmount) <= 0) return;
    await act(async () => {
      const response = await api.payment(lot.id, {
        amount: Number(paymentAmount), method: paymentMethod,
        reference: paymentReference, idempotency_key: crypto.randomUUID(),
      });
      if (response.anomaly.flagged) notify({ title: t(language, "reviewNeeded"), detail: t(language, "priceAnomalyHint"), kind: "info" });
      else if (!response.anomaly.evaluated) notify({ title: t(language, "payment"), detail: t(language, "noPriceAnomalyHint"), kind: "info" });
    }, t(language, "saveSuccess"));
  }

  const timeline = useMemo(() => lot?.events || [], [lot?.events]);
  if (loading) return <LoadingState label={t(language, "loading")} />;
  if (!lot) return <div className="page-stack"><Button variant="quiet" icon={ArrowLeft} onClick={() => navigate(-1)}>{t(language, "back")}</Button>{error && <ErrorBanner>{error}</ErrorBanner>}</div>;

  const isAssignedRecycler = user?.role === "recycler" && user.id === lot.recycler_id;
  const datetimeMin = new Date(Date.now() + 30 * 60 * 1000);
  const minSchedule = new Date(datetimeMin.getTime() - datetimeMin.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const timelineSteps = ["request_created", "request_accepted", "collection_scheduled", "handover_verified", "payment_recorded"];

  return <div className="page-stack">
    <Button className="back-link" variant="quiet" icon={ArrowLeft} onClick={() => navigate(-1)}>{t(language, "back")}</Button>
    {error && <ErrorBanner>{error}</ErrorBanner>}
    {lot.status === "sync_pending" && <div className="notice-banner notice-info"><Clock3 size={18} /><span>{t(language, "offlineNote")}</span><StatusBadge status="sync_pending" language={language} /></div>}
    <PageHeading eyebrow={lot.lot_code} title={`${materialLabel(language, lot.material)} · ${lot.weight_kg} kg`} description={`${t(language, "recyclerName")}: ${lot.recycler_name || "—"}`} action={<StatusBadge status={lot.status} language={language} />} />
    <div className="lot-detail-grid">
      <div className="lot-detail-main">
        <section className="detail-panel">
          <div className="section-heading"><div><div className="eyebrow">{t(language, "itemDetails")}</div><h2>{lot.description || materialLabel(language, lot.material)}</h2></div><div className="condition-note">{t(language, `condition_${lot.condition}` as Parameters<typeof t>[1])}</div></div>
          {photo ? <img className="lot-photo" src={photo} alt={`${materialLabel(language, lot.material)} e-waste`} /> : lot.has_photo && <div className="photo-unavailable">{t(language, "photo")}</div>}
          <div className="lot-facts"><div><small>{t(language, "weightKg")}</small><strong>{lot.weight_kg} kg</strong></div><div><small>{t(language, "offer")}</small><strong>{formatMoney(lot.quoted_price ?? 0)}</strong></div><div><small>{t(language, "expected")}</small><strong>{formatMoney(lot.estimated_low)} – {formatMoney(lot.estimated_high)}</strong></div><div><small>{t(language, "dateTime")}</small><strong>{formatDate(lot.scheduled_at, language)}</strong></div></div>
          {lot.predicted_material && <div className="ai-proof"><BadgeCheck size={17} /><span>{materialLabel(language, lot.predicted_material)} · {Math.round((lot.prediction_confidence || 0) * 100)}% {t(language, "confidence")}</span></div>}
        </section>
        <section className="detail-panel">
          <div className="section-heading"><div><div className="eyebrow">{t(language, "timeline")}</div><h2>{t(language, "safeHandover")}</h2></div><PackageCheck size={20} /></div>
          <ol className="timeline">{timeline.map((event, index) => <li className="timeline-event" key={event.id}><span className={`timeline-dot ${event.kind}`}><Check size={12} /></span><div><strong>{event.note}</strong><small>{formatDate(event.created_at, language)}</small>{event.details && Object.keys(event.details).length > 0 && <small>{Object.entries(event.details).filter(([key]) => !["lot_code", "anomaly"].includes(key)).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`).join(" · ")}</small>}</div>{index === 0 && <span className="timeline-start">01</span>}</li>)}</ol>
        </section>
      </div>
      <aside className="lot-detail-aside">
        {user?.role === "collector" && !lot.id.startsWith("offline-") && <section className="detail-panel qr-panel"><div className="eyebrow">{t(language, "scan")}</div><div className="qr-code"><QRCodeSVG value={lot.lot_code} size={156} level="M" includeMargin /></div><strong>{lot.lot_code}</strong><small>{t(language, "safeHandover")}</small><button className="text-link" onClick={() => window.print()}><Download size={15} />Print record</button></section>}
        {user?.role === "recycler" && lot.status === "requested" && isAssignedRecycler && <section className="detail-panel action-panel"><div className="eyebrow">{t(language, "requests")}</div><h2>{t(language, "requestFor")}</h2><p>{t(language, "demoOnly")}</p><Button onClick={() => void act(() => api.acceptLot(lot.id), t(language, "accept"))} disabled={busy} icon={Check}>{t(language, "accept")}</Button><Button variant="quiet" onClick={() => void act(() => api.declineLot(lot.id), t(language, "decline"))} disabled={busy}>{t(language, "decline")}</Button></section>}
        {user?.role === "collector" && ["requested", "accepted", "scheduled"].includes(lot.status) && !lot.id.startsWith("offline-") && <section className="detail-panel action-panel"><div className="eyebrow">{t(language, "schedule")}</div><h2>{t(language, "dateTime")}</h2><form onSubmit={(event) => { event.preventDefault(); if (scheduleValue) void act(() => api.scheduleLot(lot.id, { collection_mode: mode, scheduled_at: new Date(scheduleValue).toISOString() }), t(language, "schedule")); }}>
          <Field label={t(language, "collectionMode")}><select value={mode} onChange={(event) => setMode(event.target.value as "pickup" | "dropoff")}><option value="pickup">{t(language, "pickup")}</option><option value="dropoff">{t(language, "dropoff")}</option></select></Field><Field label={t(language, "dateTime")}><input type="datetime-local" min={minSchedule} value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} required /></Field><Button type="submit" disabled={busy}>{t(language, "schedule")}</Button></form></section>}
        {user?.role === "recycler" && isAssignedRecycler && ["accepted", "scheduled"].includes(lot.status) && <section className="detail-panel action-panel"><div className="eyebrow">{t(language, "safeHandover")}</div><h2>{t(language, "verifyHandover")}</h2><div className="scan-code"><QRScanner onCode={setQrValue} startLabel={t(language, "startCamera")} stopLabel={t(language, "stopCamera")} unavailableLabel={t(language, "cameraUnavailable")} /><label className="field"><span className="field-label">{t(language, "verifyCode")}</span><input value={qrValue} onChange={(event) => setQrValue(event.target.value.toUpperCase())} placeholder={lot.lot_code} autoCapitalize="characters" /></label></div><form onSubmit={submitHandover}>
          <Field label={t(language, "confirmMaterial")}><select value={confirmedMaterial} onChange={(event) => setConfirmedMaterial(event.target.value as Material)}>{materials.map((item) => <option value={item} key={item}>{materialLabel(language, item)}</option>)}</select></Field><Field label={t(language, "description")}><input value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} maxLength={500} /></Field><Button type="submit" disabled={busy || !qrValue} icon={ShieldCheck}>{t(language, "verifyHandover")}</Button>
        </form></section>}
        {user?.role === "recycler" && isAssignedRecycler && lot.status === "handed_over" && <section className="detail-panel action-panel"><div className="eyebrow">{t(language, "payment")}</div><h2>{t(language, "submitPayment")}</h2><form onSubmit={submitPayment}>
          <Field label={t(language, "amountReceived")}><input type="number" min="0.01" step="0.01" max="10000000" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></Field><Field label={t(language, "paymentMethod")}><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="upi">UPI</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="other">Other</option></select></Field><Field label={t(language, "reference")}><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} maxLength={120} /></Field><Button type="submit" disabled={busy} icon={CircleDollarSign}>{t(language, "submitPayment")}</Button>
        </form></section>}
        {lot.status === "paid" && <section className="detail-panel payment-receipt"><div className="receipt-icon"><Check size={23} /></div><div className="eyebrow">{t(language, "payment")}</div><strong>{formatMoney(lot.final_price || 0)}</strong><span>{lot.payment?.method?.replaceAll("_", " ").toUpperCase()} · {formatDate(lot.payment?.updated_at, language)}</span>{lot.payment?.reference && <small>{t(language, "reference")}: {lot.payment.reference}</small>}</section>}
        {lot.anomaly_flag && <div className="notice-banner notice-warning"><ShieldAlert size={18} /><span>{t(language, "priceAnomalyHint")}</span></div>}
        {lot.latitude !== null && lot.longitude !== null && <a className="location-link" href={`https://www.openstreetmap.org/?mlat=${lot.latitude}&mlon=${lot.longitude}#map=16/${lot.latitude}/${lot.longitude}`} target="_blank" rel="noreferrer"><MapPin size={16} />{t(language, "direction")}</a>}
      </aside>
    </div>
  </div>;
}
