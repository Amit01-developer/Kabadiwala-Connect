import { useState, type FormEvent } from "react";
import { ArrowRight, Recycle, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../auth";
import { t } from "../i18n";
import { useToast } from "../components/ui";
import type { Language, Role } from "../types";

const demoAccounts: { role: Role; email: string; password: string }[] = [
  { role: "collector", email: "collector@demo.kabadwala.local", password: "DemoCollector2026!" },
  { role: "recycler", email: "recycler.green@demo.kabadwala.local", password: "DemoRecycler2026!" },
  { role: "admin", email: "admin@demo.kabadwala.local", password: "DemoAdmin2026!" },
];

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const notify = useToast();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [language, setLanguage] = useState<Language>("en");
  const [accountType, setAccountType] = useState<"collector" | "recycler">("collector");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", organization: "", license_number: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const text = (key: Parameters<typeof t>[1]) => t(language, key);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await signIn(form.email, form.password);
      else await signUp({
        name: form.name, email: form.email, password: form.password,
        phone: form.phone || null, preferred_language: language, account_type: accountType,
        ...(accountType === "recycler" ? { organization: form.organization, license_number: form.license_number } : {}),
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : mode === "login" ? text("signInFailed") : text("registerFailed");
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function useDemo(account: typeof demoAccounts[number]) {
    setForm((current) => ({ ...current, email: account.email, password: account.password }));
    setMode("login");
    setError("");
    notify({ title: `${text(account.role === "admin" ? "navAdmin" : account.role)} demo`, detail: text("demoOnly"), kind: "info" });
  }

  return <main className="auth-screen">
    <div className="auth-topline">
      <div className="brand-lockup"><span className="brand-symbol"><Recycle size={23} /></span><span>Kabadiwala <strong>Connect</strong></span></div>
      <label className="language-select auth-language"><span className="sr-only">{text("language")}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="en">English</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option>
        </select>
      </label>
    </div>
    <div className="auth-grid">
      <section className="auth-intro">
        <div className="auth-tag"><span></span> VERIFIED COLLECTION NETWORK</div>
        <h1>Give e-waste<br /><em>a better next life.</em></h1>
        <p>Clear rates, trusted recycling partners, and a record for every handover.</p>
        <div className="auth-points">
          <div><ShieldCheck size={19} /><span>Authorized recycler matching</span></div>
          <div><Sparkles size={19} /><span>Transparent, traceable transactions</span></div>
          <div><Recycle size={19} /><span>Responsible recycling, from first item to payment</span></div>
        </div>
        <div className="auth-impact"><span>01</span><div><strong>Collector</strong><span>Capture · price · connect</span></div><ArrowRight size={17} /><span>02</span><div><strong>Recycler</strong><span>Verify · recover · pay</span></div></div>
      </section>
      <section className="auth-panel">
        <div className="auth-heading"><div className="eyebrow">KABADIWALA CONNECT</div><h2>{mode === "login" ? text("welcomeBack") : text("createAccount")}</h2><p>{mode === "login" ? text("enterAccount") : text("terms")}</p></div>
        <div className="segment-control" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>{text("signIn")}</button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>{text("createAccount")}</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && <>
            <label className="field"><span className="field-label">{text("fullName")}</span><input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <div className="account-type-control"><span className="field-label">{text("accountType")}</span><div className="segment-control">
              {(["collector", "recycler"] as const).map((role) => <button type="button" className={accountType === role ? "active" : ""} key={role} onClick={() => setAccountType(role)}>{text(role)}</button>)}
            </div></div>
            {accountType === "recycler" && <div className="form-row">
              <label className="field"><span className="field-label">{text("organization")}</span><input required minLength={2} maxLength={160} value={form.organization} onChange={(event) => setForm({ ...form, organization: event.target.value })} /></label>
              <label className="field"><span className="field-label">{text("authorizationNumber")}</span><input required minLength={3} maxLength={80} value={form.license_number} onChange={(event) => setForm({ ...form, license_number: event.target.value })} /></label>
            </div>}
          </>}
          <label className="field"><span className="field-label">{text("email")}</span><input required type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          {mode === "register" && <label className="field"><span className="field-label">{text("phone")} <small>{text("optional")}</small></span><input type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>}
          <label className="field"><span className="field-label">{text("password")}</span><input required type="password" minLength={mode === "register" ? 10 : 1} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small className="field-hint">{mode === "register" ? text("demoInvite") : ""}</small></label>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? text("loading") : mode === "login" ? text("signIn") : text("createAccount")}<ArrowRight size={17} /></button>
        </form>
        {mode === "login" && (import.meta.env.VITE_DEMO_ACCESS as string | undefined) !== "false" && <div className="demo-block">
          <div className="demo-label">{text("tryDemo")}</div>
          <div className="demo-buttons">{demoAccounts.map((account) => <button key={account.role} onClick={() => useDemo(account)} type="button">{text(account.role === "admin" ? "navAdmin" : account.role)}<ArrowRight size={14} /></button>)}</div>
          <p>{text("demoOnly")}</p>
        </div>}
      </section>
    </div>
    <footer className="auth-footer"><span>© 2026 Kabadiwala Connect</span><span>{text("acceptTerms")}</span></footer>
  </main>;
}
