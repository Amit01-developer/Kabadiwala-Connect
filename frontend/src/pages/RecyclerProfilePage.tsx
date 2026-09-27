import { useEffect, useState, type FormEvent } from "react";
import { LocateFixed, Save, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorBanner, Field, LoadingState, MaterialTile, PageHeading, useToast } from "../components/ui";
import { t } from "../i18n";
import type { Material } from "../types";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];
type Profile = { organization: string; license_number: string; verified: boolean; latitude: number | null; longitude: number | null; address: string; materials: Material[]; offers: Record<string, number>; pickup_available: boolean; dropoff_available: boolean };

export function RecyclerProfilePage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const notify = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.recyclerProfile().then((result) => setProfile(result.profile)).catch((reason) => setError(reason instanceof Error ? reason.message : t(language, "requestError"))).finally(() => setLoading(false)); }, []);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((current) => current ? { ...current, [key]: value } : current);
  }

  function useGps() {
    if (!navigator.geolocation) { setError(t(language, "missingCoordinate")); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setProfile((current) => current ? { ...current, latitude: position.coords.latitude, longitude: position.coords.longitude } : current);
      setLocating(false);
    }, () => { setLocating(false); setError(t(language, "missingCoordinate")); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setSaving(true); setError("");
    try {
      const { verified: _verified, ...payload } = profile;
      const result = await api.updateRecyclerProfile(payload as unknown as Record<string, unknown>);
      setProfile((current) => current ? { ...current, verified: result.verified } : current);
      notify({ title: t(language, "saveSuccess"), kind: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
    finally { setSaving(false); }
  }

  if (loading) return <LoadingState label={t(language, "loading")} />;
  if (!profile) return <div className="page-stack">{error && <ErrorBanner>{error}</ErrorBanner>}</div>;
  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    {!profile.verified && <div className="notice-banner notice-warning"><ShieldCheck size={18} /><span>{t(language, "verificationPending")}</span></div>}
    <PageHeading eyebrow={t(language, "profile")} title={profile.organization} description={profile.verified ? t(language, "verifiedPartner") : t(language, "unverifiedPartner")} />
    <form className="profile-layout" onSubmit={submit}>
      <section className="detail-panel profile-form"><div className="section-heading"><div><div className="eyebrow">{t(language, "organizationHelp")}</div><h2>{t(language, "serviceArea")}</h2></div></div>
        <div className="form-grid two-col"><Field label={t(language, "organization")}><input required minLength={2} maxLength={160} value={profile.organization} onChange={(event) => update("organization", event.target.value)} /></Field><Field label={t(language, "authorizationNumber")}><input required minLength={3} maxLength={80} value={profile.license_number} onChange={(event) => update("license_number", event.target.value)} /></Field></div>
        <Field label={t(language, "address")}><input required minLength={3} maxLength={240} value={profile.address} onChange={(event) => update("address", event.target.value)} /></Field>
        <div className="form-grid three-col"><Field label={t(language, "latitude")}><input type="number" step="any" min="-90" max="90" value={profile.latitude ?? ""} onChange={(event) => update("latitude", event.target.value ? Number(event.target.value) : null)} required /></Field><Field label={t(language, "longitude")}><input type="number" step="any" min="-180" max="180" value={profile.longitude ?? ""} onChange={(event) => update("longitude", event.target.value ? Number(event.target.value) : null)} required /></Field><div className="gps-field"><span className="field-label">GPS</span><Button type="button" variant="outline" icon={LocateFixed} onClick={useGps} disabled={locating}>{locating ? t(language, "loading") : t(language, "useLocation")}</Button></div></div>
        <div className="form-actions"><Button type="submit" icon={Save} disabled={saving}>{saving ? t(language, "loading") : t(language, "saveProfile")}</Button></div>
      </section>
      <aside className="profile-side">
        <section className="detail-panel"><div className="eyebrow">{t(language, "acceptedMaterials")}</div><div className="profile-materials">{materials.map((material) => <MaterialTile key={material} material={material} language={language} selected={profile.materials.includes(material)} onClick={() => update("materials", profile.materials.includes(material) ? (profile.materials.length > 1 ? profile.materials.filter((item) => item !== material) : profile.materials) : [...profile.materials, material])} />)}</div></section>
        <section className="detail-panel"><div className="eyebrow">{t(language, "offerRate")}</div><h2>{t(language, "ratePerKg")}</h2><p className="field-hint">Use the rate your organization will honor for each listed material.</p><div className="offer-inputs">{profile.materials.map((material) => <label key={material}><span>{t(language, `material_${material}` as Parameters<typeof t>[1])}</span><span className="currency-input"><b>₹</b><input type="number" min="0.01" max="1000000" step="0.01" value={profile.offers[material] ?? ""} onChange={(event) => { const offers = { ...profile.offers }; if (event.target.value) offers[material] = Number(event.target.value); else delete offers[material]; update("offers", offers); }} /></span></label>)}</div></section>
        <section className="detail-panel"><div className="eyebrow">{t(language, "availableModes")}</div><label className="toggle-row"><span>{t(language, "pickupAvailable")}</span><input type="checkbox" checked={profile.pickup_available} onChange={(event) => update("pickup_available", event.target.checked)} /></label><label className="toggle-row"><span>{t(language, "dropoffAvailable")}</span><input type="checkbox" checked={profile.dropoff_available} onChange={(event) => update("dropoff_available", event.target.checked)} /></label></section>
      </aside>
    </form>
  </div>;
}
