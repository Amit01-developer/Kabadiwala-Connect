import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, BadgeCheck, Building2, Plus, ShieldAlert, ShieldCheck, UserPlus } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, ErrorBanner, Field, LoadingState, PageHeading, useToast } from "../components/ui";
import { materialLabel, t } from "../i18n";
import type { Material, Recycler } from "../types";

const materials: Material[] = ["mobile", "laptop", "tv", "battery", "printer", "other"];

export function AdminRecyclersPage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const notify = useToast();
  const [recyclers, setRecyclers] = useState<Recycler[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", organization: "", license_number: "", address: "", latitude: "", longitude: "" });

  function load() { return api.adminRecyclers().then((data) => { setRecyclers(data.recyclers); setError(""); }).catch((reason) => setError(reason instanceof Error ? reason.message : t(language, "requestError"))).finally(() => setLoading(false)); }
  useEffect(() => { void load(); }, []);

  async function verify(item: Recycler) {
    setError("");
    try {
      await api.verifyRecycler(item.id, !item.verified, "Authorization reviewed by platform administrator.");
      await load();
      notify({ title: item.verified ? t(language, "revoke") : t(language, "approve"), kind: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      await api.createRecycler({
        ...form, latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        materials, offers: {}, verified: false,
      });
      setForm({ name: "", email: "", password: "", organization: "", license_number: "", address: "", latitude: "", longitude: "" });
      setShowCreate(false);
      await load();
      notify({ title: t(language, "saveSuccess"), detail: t(language, "verificationPending"), kind: "success" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : t(language, "requestError")); }
    finally { setSaving(false); }
  }

  return <div className="page-stack">
    {error && <ErrorBanner>{error}</ErrorBanner>}
    <PageHeading eyebrow={t(language, "navAdmin")} title={t(language, "verify")} description={t(language, "demoOnly")} action={<Button icon={Plus} onClick={() => setShowCreate((value) => !value)}>{t(language, "addRecycler")}</Button>} />
    {showCreate && <section className="detail-panel create-recycler-panel"><div className="section-heading"><div><div className="eyebrow">{t(language, "addRecycler")}</div><h2>{t(language, "organizationHelp")}</h2></div><UserPlus size={20} /></div><form className="form-grid two-col" onSubmit={create}>
      <Field label={t(language, "fullName")}><input required minLength={2} maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label={t(language, "email")}><input type="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
      <Field label={t(language, "password")} hint={t(language, "demoInvite")}><input type="password" required minLength={10} maxLength={128} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field><Field label={t(language, "organization")}><input required minLength={2} maxLength={160} value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} /></Field>
      <Field label={t(language, "authorizationNumber")}><input required minLength={3} maxLength={80} value={form.license_number} onChange={(event) => setForm({ ...form, license_number: event.target.value })} /></Field><Field label={t(language, "address")}><input maxLength={240} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
      <Field label={t(language, "latitude")}><input type="number" min="-90" max="90" step="any" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></Field><Field label={t(language, "longitude")}><input type="number" min="-180" max="180" step="any" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></Field>
      <div className="form-actions span-two"><Button type="submit" disabled={saving}>{saving ? t(language, "loading") : t(language, "addRecycler")}</Button><Button type="button" variant="quiet" onClick={() => setShowCreate(false)}>{t(language, "cancel")}</Button></div>
    </form></section>}
    {loading ? <LoadingState label={t(language, "loading")} /> : recyclers.length === 0 ? <div className="empty-state"><Building2 size={23} /><strong>{t(language, "noLots")}</strong></div> : <div className="admin-table-wrap"><table className="data-table"><thead><tr><th>{t(language, "organization")}</th><th>{t(language, "authorizationNumber")}</th><th>{t(language, "address")}</th><th>{t(language, "materialGuide")}</th><th>{t(language, "status")}</th><th></th></tr></thead><tbody>{recyclers.map((item) => <tr key={item.id}>
      <td><div className="table-primary">{item.organization}<small>{item.email}</small></div></td><td><code>{item.license_number}</code></td><td>{item.address || t(language, "noAddress")}</td><td><div className="table-tags">{item.materials.map((value) => <span key={value}>{materialLabel(language, value)}</span>)}</div></td><td><span className={`verification-state ${item.verified ? "verified" : "unverified"}`}>{item.verified ? <BadgeCheck size={15} /> : <ShieldAlert size={15} />}{item.verified ? t(language, "verifiedPartner") : t(language, "unverifiedPartner")}</span></td><td><button className={`button button-small ${item.verified ? "button-danger" : "button-secondary"}`} onClick={() => void verify(item)}>{item.verified ? t(language, "revoke") : t(language, "approve")}<ArrowRight size={14} /></button></td>
    </tr>)}</tbody></table></div>}
    <div className="notice-banner notice-warning"><ShieldAlert size={18} /><span>{t(language, "demoOnly")}</span></div>
  </div>;
}
