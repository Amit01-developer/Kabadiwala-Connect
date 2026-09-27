import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { RecyclerMap } from "../components/RecyclerMap";
import { Button, ErrorBanner, Field, formatMoney, MaterialTile, PageHeading, useToast } from "../components/ui";
import { materialLabel, t } from "../i18n";
import { queueLot } from "../storage";
import type { Condition, CreateLotPayload, Language, Material, Quote, Recycler } from "../types";
import { ArrowLeft, ArrowRight, Camera, Check, CircleHelp, LocateFixed, Mic, MicOff, Recycle, ScanSearch, ShieldCheck, Upload } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];
const conditions: Condition[] = ["excellent", "good", "fair", "poor"];
const conditionFactor: Record<Condition, number> = { excellent: 1, good: 0.88, fair: 0.7, poor: 0.48 };
type Recognition = { material: Material | null; confidence: number; alternatives: { material: Material; confidence: number }[]; needs_confirmation: boolean };
type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  lang: string;
  onresult: ((event: Event) => void) | null;
  onend: (() => void) | null;
};

function datetimeDefault() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(10, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is not supported by this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.82;
    let result = canvas.toDataURL("image/jpeg", quality);
    while (result.length > 2_600_000 && quality > 0.45) {
      quality -= 0.1;
      result = canvas.toDataURL("image/jpeg", quality);
    }
    if (result.length > 2_600_000) throw new Error("Choose a smaller image.");
    return result;
  } finally { URL.revokeObjectURL(src); }
}

function localEstimate(material: Material, weight: number, condition: Condition, rate: number, history: number[]): Quote {
  const center = history.length ? history.reduce((sum, item) => sum + item, 0) / history.length : rate;
  const variation = history.length > 1 ? Math.min(0.18, Math.max(0.05, (Math.max(...history) - Math.min(...history)) / center / 2)) : 0.08;
  const expected = rate * conditionFactor[condition] * weight;
  return {
    material, weight_kg: weight, condition, market_rate_per_kg: rate,
    condition_factor: conditionFactor[condition], estimated_rate_per_kg: rate * conditionFactor[condition],
    estimated_low: Math.round(expected * (1 - variation)), estimated_expected: Math.round(expected),
    estimated_high: Math.round(expected * (1 + variation)), variation_percent: Math.round(variation * 1000) / 10,
    source: "Saved rate board", model_used: false, updated_at: new Date().toISOString(),
  };
}

function VoiceNotes({ language, onText }: { language: Language; onText: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const locale = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" }[language];
  function toggle() {
    const browser = window as Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Speech = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Speech) { setUnsupported(true); return; }
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const instance = new Speech();
    instance.lang = locale;
    instance.onresult = (event) => {
      const result = event as Event & { results?: ArrayLike<ArrayLike<{ transcript: string }>> };
      const transcript = result.results?.[0]?.[0]?.transcript;
      if (transcript) onText(transcript);
    };
    instance.onend = () => setListening(false);
    recognition.current = instance;
    instance.start();
    setListening(true);
    setUnsupported(false);
  }
  return <div className="voice-control"><button type="button" className={`voice-button ${listening ? "listening" : ""}`} onClick={toggle} aria-pressed={listening}>{listening ? <MicOff size={16} /> : <Mic size={16} />}{listening ? t(language, "listening") : t(language, "speakNotes")}</button>{unsupported && <small>{t(language, "recorderUnsupported")}</small>}</div>;
}

export function NewLotPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const language = user?.preferred_language || "en";
  const [step, setStep] = useState(0);
  const [material, setMaterial] = useState<Material>("mobile");
  const [weight, setWeight] = useState(1);
  const [condition, setCondition] = useState<Condition>("good");
  const [description, setDescription] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [recognition, setRecognition] = useState<Recognition | null>(null);
  const [classifyMessage, setClassifyMessage] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [recyclers, setRecyclers] = useState<Recycler[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [collectionMode, setCollectionMode] = useState<"pickup" | "dropoff">("pickup");
  const [scheduledAt, setScheduledAt] = useState(datetimeDefault());
  const [location, setLocation] = useState<[number, number] | null>(null);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rates, setRates] = useState<Awaited<ReturnType<typeof api.prices>> | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const currentRecycler = recyclers.find((recycler) => recycler.id === selectedId);
  const stepLabels = [t(language, "itemDetails"), t(language, "estimate"), t(language, "chooseRecycler")];

  useEffect(() => { api.prices().then(setRates).catch(() => undefined); }, []);

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageError("");
    try {
      const data = await compressPhoto(file);
      setImageData(data);
      setImagePreview(data);
      setRecognition(null);
      setClassifyMessage("");
    } catch (reason) {
      setImageError(reason instanceof Error ? reason.message : t(language, "uploadIssue"));
    } finally { event.target.value = ""; }
  }

  async function identify() {
    if (!imageData) return;
    setClassifying(true);
    setClassifyMessage("");
    try {
      const result = await api.classify(imageData);
      setRecognition(result);
      if (result.material) setMaterial(result.material);
      setClassifyMessage(result.needs_confirmation ? t(language, "modelUncertain") : t(language, "modelAvailable"));
    } catch (reason) {
      setRecognition(null);
      setClassifyMessage(reason instanceof ApiError && reason.status === 503 ? t(language, "noPhotoModel") : reason instanceof Error ? reason.message : t(language, "requestError"));
    } finally { setClassifying(false); }
  }

  function useGps() {
    if (!navigator.geolocation) { setError(t(language, "missingCoordinate")); return; }
    setLoadingLocation(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setLocation([position.coords.latitude, position.coords.longitude]);
      setLoadingLocation(false);
      setError("");
    }, () => {
      setLoadingLocation(false);
      setError(t(language, "missingCoordinate"));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  }

  async function getQuote() {
    if (!Number.isFinite(weight) || weight <= 0) { setError(t(language, "invalidWeight")); return; }
    setError("");
    try {
      const result = await api.quote({ material, weight_kg: weight, condition, latitude: location?.[0] ?? null, longitude: location?.[1] ?? null });
      setQuote(result);
      setStep(1);
    } catch (reason) {
      if (!navigator.onLine || reason instanceof ApiError && reason.status === 0) {
        const rate = rates?.rates.find((item) => item.material === material);
        if (rate) {
          setQuote(localEstimate(material, weight, condition, rate.rate_per_kg, rate.history.map((point) => point.rate_per_kg)));
          setStep(1);
          return;
        }
      }
      setError(reason instanceof Error ? reason.message : t(language, "requestError"));
      return;
    }
    setStep(1);
  }

  useEffect(() => {
    if (step !== 2) return;
    let active = true;
    setLoadingMatches(true);
    api.recyclers(material, location?.[0] ?? null, location?.[1] ?? null, collectionMode)
      .then((response) => { if (active) { setRecyclers(response.recyclers); setSelectedId((current) => response.recyclers.some((item) => item.id === current) ? current : response.recyclers[0]?.id || ""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t(language, "requestError")); })
      .finally(() => { if (active) setLoadingMatches(false); });
    return () => { active = false; };
  }, [step, material, location, collectionMode, language]);

  async function submit() {
    if (!quote || !currentRecycler) { setError(t(language, "selectRecycler")); return; }
    if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) { setError(t(language, "chooseDate")); return; }
    const payload: CreateLotPayload = {
      material, weight_kg: weight, condition, latitude: location?.[0] ?? null,
      longitude: location?.[1] ?? null, recycler_id: currentRecycler.id,
      description, collection_mode: collectionMode,
      scheduled_at: new Date(scheduledAt).toISOString(), image_data_url: imageData,
      predicted_material: recognition?.material ?? null,
      prediction_confidence: recognition?.confidence ?? null,
      client_ref: crypto.randomUUID(),
    };
    setSaving(true);
    setError("");
    try {
      const lot = await api.createLot(payload);
      notify({ title: t(language, "requestSent"), detail: lot.lot_code, kind: "success" });
      navigate(`/lots/${lot.id}`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 0 || !navigator.onLine) {
        try {
          if (!user) throw new Error(t(language, "requestError"));
          const draft = await queueLot(payload, quote, currentRecycler, user.id);
          notify({ title: t(language, "syncPending"), detail: t(language, "offlineNote"), kind: "info" });
          navigate(`/lots/${draft.id}`);
        } catch (storageError) {
          setError(storageError instanceof Error ? storageError.message : t(language, "requestError"));
        }
      } else setError(reason instanceof Error ? reason.message : t(language, "requestError"));
    } finally { setSaving(false); }
  }

  const trend = useMemo(() => rates?.rates.find((rate) => rate.material === material)?.history || [], [rates, material]);
  const voiceAppend = (text: string) => setDescription((value) => `${value}${value ? " " : ""}${text}`.slice(0, 1000));

  return <div className="page-stack">
    <PageHeading eyebrow={`${t(language, "newLot")} · ${step + 1} / 3`} title={t(language, "newCollection")} description={t(language, "requestFor")} />
    <div className="wizard-steps">{stepLabels.map((label, index) => <button key={label} className={`wizard-step ${step === index ? "active" : ""} ${step > index ? "complete" : ""}`} onClick={() => { if (index < step) setStep(index); }} disabled={index > step}>
      <span>{step > index ? <Check size={15} /> : `0${index + 1}`}</span><strong>{label}</strong>
    </button>)}</div>
    {error && <ErrorBanner>{error}</ErrorBanner>}

    {step === 0 && <div className="wizard-layout">
      <section className="form-section">
        <div className="section-heading"><div><div className="eyebrow">01 · {t(language, "chooseMaterial")}</div><h2>{t(language, "itemDetails")}</h2></div></div>
        <div className="material-grid">{materials.map((item) => <MaterialTile key={item} material={item} language={language} selected={item === material} onClick={() => { setMaterial(item); if (recognition?.material) setRecognition(null); }} />)}</div>
        <div className="photo-upload">
          {imagePreview ? <div className="photo-preview"><img src={imagePreview} alt={t(language, "photo")} /><button type="button" onClick={() => { setImageData(null); setImagePreview(null); setRecognition(null); }}>{t(language, "cancel")}</button></div> : <button type="button" className="photo-drop" onClick={() => photoInput.current?.click()}><span><Camera size={22} /></span><strong>{t(language, "photo")}</strong><small>JPG, PNG, WebP · max 2 MB after resize</small><span className="button button-secondary"><Upload size={16} />{t(language, "gallery")}</span></button>}
          <input ref={photoInput} className="sr-only" type="file" accept="image/*" capture="environment" onChange={choosePhoto} />
          {imageError && <small className="field-error">{imageError}</small>}
          {imageData && <div className="ai-identify"><Button type="button" variant="outline" icon={ScanSearch} onClick={() => void identify()} disabled={classifying}>{classifying ? t(language, "analyzing") : t(language, "analyze")}</Button>{recognition && <span>{recognition.material ? `${materialLabel(language, recognition.material)} · ${Math.round(recognition.confidence * 100)}%` : t(language, "modelUncertain")}</span>}{classifyMessage && <small>{classifyMessage}</small>}</div>}
        </div>
        <div className="form-grid two-col">
          <Field label={t(language, "weightKg")}><input type="number" min="0.1" max="5000" step="0.1" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></Field>
          <Field label={t(language, "condition")}><select value={condition} onChange={(event) => setCondition(event.target.value as Condition)}>{conditions.map((item) => <option key={item} value={item}>{t(language, `condition_${item}` as Parameters<typeof t>[1])}</option>)}</select></Field>
        </div>
        <Field label={t(language, "description")} hint={t(language, "optional")}>
          <textarea rows={3} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t(language, "voiceHint")} />
          <VoiceNotes language={language} onText={voiceAppend} />
        </Field>
        <div className="location-row"><div><strong>{t(language, "useLocation")}</strong><small>{location ? `${location[0].toFixed(4)}, ${location[1].toFixed(4)}` : t(language, "turnOnGps")}</small></div><Button type="button" variant={location ? "secondary" : "outline"} icon={LocateFixed} onClick={useGps} disabled={loadingLocation}>{loadingLocation ? t(language, "loading") : location ? t(language, "locationOn") : t(language, "useLocation")}</Button></div>
        <div className="form-actions"><Button type="button" onClick={() => void getQuote()} icon={ArrowRight}>{t(language, "continue")}</Button></div>
      </section>
      <aside className="wizard-aside"><div className="aside-heading"><CircleHelp size={19} /><strong>{t(language, "safeHandling")}</strong></div><p>{t(language, "safetyOne")}</p><p>{t(language, "safetyFour")}</p><div className="aside-note"><ShieldCheck size={17} />{t(language, "privacy")}</div></aside>
    </div>}

    {step === 1 && quote && <div className="quote-layout">
      <section className="quote-main">
        <div className="quote-hero"><div className="quote-kicker"><span>{t(language, "safePrice")}</span><span className="quote-live"><i />{quote.source.includes("Saved") ? t(language, "offline") : t(language, "online")}</span></div><div className="quote-material">{materialLabel(language, material)} · {weight} kg · {t(language, `condition_${condition}` as Parameters<typeof t>[1])}</div><strong>{formatMoney(quote.estimated_expected)}</strong><div className="quote-range"><span>{t(language, "range")}</span><b>{formatMoney(quote.estimated_low)} – {formatMoney(quote.estimated_high)}</b></div><small>{t(language, "rangeNotice")}</small></div>
        <div className="quote-data-grid"><div><small>{t(language, "marketRate")}</small><strong>{formatMoney(quote.market_rate_per_kg)} / kg</strong></div><div><small>{t(language, "ratePerKg")}</small><strong>{formatMoney(quote.estimated_rate_per_kg)} / kg</strong></div><div><small>{t(language, "condition")}</small><strong>{Math.round(quote.condition_factor * 100)}%</strong></div><div><small>{t(language, "rateSource")}</small><strong>{quote.source}</strong></div></div>
        <div className="quote-chart"><div className="section-heading"><div><div className="eyebrow">{t(language, "priceHistory")}</div><h2>{materialLabel(language, material)}</h2></div></div>{trend.length > 1 ? <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trend}><defs><linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#27795a" stopOpacity={0.22} /><stop offset="95%" stopColor="#27795a" stopOpacity={0.02} /></linearGradient></defs><XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })} tickLine={false} axisLine={false} /><YAxis width={40} tickLine={false} axisLine={false} /><Tooltip formatter={(value) => [formatMoney(Number(value)), t(language, "ratePerKg")]} labelFormatter={(value) => new Date(String(value)).toLocaleDateString()} /><Area type="monotone" dataKey="rate_per_kg" stroke="#27795a" strokeWidth={2.5} fill="url(#rateFill)" /></AreaChart></ResponsiveContainer></div> : <div className="chart-empty">{t(language, "noActivityHint")}</div>}</div>
        <div className="notice-banner notice-info"><CircleHelp size={18} /><span>{t(language, "rangeNotice")}</span></div>
        <div className="form-actions"><Button type="button" variant="quiet" icon={ArrowLeft} onClick={() => setStep(0)}>{t(language, "back")}</Button><Button type="button" icon={ArrowRight} onClick={() => { setError(""); setStep(2); }}>{t(language, "chooseRecycler")}</Button></div>
      </section>
      <aside className="wizard-aside"><div className="aside-heading"><BadgeRupeeIcon /><strong>{t(language, "transparentPricing")}</strong></div><p>{t(language, "demoOnly")}</p><div className="aside-note"><ShieldCheck size={17} />{t(language, "safetyTwo")}</div></aside>
    </div>}

    {step === 2 && quote && <div className="match-layout">
      <section className="match-main">
        <div className="section-heading"><div><div className="eyebrow">03 · {t(language, "chooseRecycler")}</div><h2>{t(language, "chooseRecycler")}</h2><p>{t(language, "verifiedPartner")}</p></div><div className="match-total"><small>{t(language, "expected")}</small><strong>{formatMoney(quote.estimated_expected)}</strong></div></div>
        <div className="mode-select"><button className={collectionMode === "pickup" ? "active" : ""} onClick={() => setCollectionMode("pickup")} type="button"><span className="mode-symbol">01</span><span><strong>{t(language, "pickup")}</strong><small>{t(language, "dateTime")}</small></span></button><button className={collectionMode === "dropoff" ? "active" : ""} onClick={() => setCollectionMode("dropoff")} type="button"><span className="mode-symbol">02</span><span><strong>{t(language, "dropoff")}</strong><small>{t(language, "seeMap")}</small></span></button></div>
        <Field label={t(language, "dateTime")}><input type="datetime-local" min={datetimeDefault()} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></Field>
        <div className="match-list-heading"><strong>{t(language, "recyclerName")}</strong><span>{location ? t(language, "sortNearby") : t(language, "verifiedPartner")}</span></div>
        {loadingMatches ? <div className="loading-state">{t(language, "loadingMap")}</div> : recyclers.length === 0 ? <div className="notice-banner notice-warning"><ShieldCheck size={19} /><span>{t(language, "noMatchingRecycler")}</span></div> : <div className="recycler-options">{recyclers.map((item) => <button className={`recycler-option ${selectedId === item.id ? "selected" : ""}`} type="button" onClick={() => setSelectedId(item.id)} key={item.id}>
          <span className="partner-mark"><Recycle size={19} /></span><span className="partner-info"><strong>{item.organization}</strong><small>{item.address || t(language, "noAddress")} · {item.distance_km === null ? t(language, "missingCoordinate") : `${item.distance_km} km`}</small><span><ShieldCheck size={13} />{t(language, "verifiedPartner")}</span></span><span className="partner-offer"><strong>{formatMoney(item.offer_per_kg)}</strong><small>/ kg</small></span><span className="radio-dot" />
        </button>)}</div>}
        <div className="form-actions"><Button type="button" variant="quiet" icon={ArrowLeft} onClick={() => setStep(1)}>{t(language, "back")}</Button><Button type="button" icon={saving ? undefined : ArrowRight} onClick={() => void submit()} disabled={saving || !selectedId || loadingMatches}>{saving ? t(language, "requestSaving") : t(language, "createRequest")}</Button></div>
        <div className="offline-note"><WifiNoteIcon />{t(language, "offlineNote")}</div>
      </section>
      <aside className="match-aside">
        <div className="map-title"><div><div className="eyebrow">{t(language, "recyclers")}</div><strong>{t(language, "loadingMap")}</strong></div><LocateFixed size={18} /></div>
        <RecyclerMap recyclers={recyclers} origin={location} selectedId={selectedId} onSelect={setSelectedId} height={280} />
        <div className="map-disclaimer">© OpenStreetMap contributors</div>
        {currentRecycler && <div className="selected-quote"><span>{t(language, "quoteFrom")}</span><strong>{currentRecycler.organization}</strong><div><small>{t(language, "offer")}</small><b>{formatMoney(currentRecycler.offer_per_kg)} / kg</b></div><div><small>{t(language, "expected")}</small><b>{formatMoney(currentRecycler.offer_per_kg * weight * conditionFactor[condition])}</b></div>{currentRecycler.maps_url && <a href={currentRecycler.maps_url} target="_blank" rel="noreferrer">{t(language, "direction")}<ArrowRight size={14} /></a>}</div>}
      </aside>
    </div>}
  </div>;
}

function BadgeRupeeIcon() { return <span className="rupee-mark">₹</span>; }
function WifiNoteIcon() { return <span className="offline-note-mark"><Check size={14} /></span>; }
