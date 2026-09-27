import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity, Boxes, ChartNoAxesCombined, ClipboardCheck,
  CloudOff, Database, FileCheck2, Home, MapPinned, PackagePlus, Recycle,
  ShieldCheck, Sprout, Wifi, WifiOff, RefreshCw, UserRound, LogOut,
} from "lucide-react";
import { useAuth } from "../auth";
import { api } from "../api";
import { readQueue } from "../storage";
import { t } from "../i18n";
import type { Language, Role } from "../types";
import { useToast } from "./ui";

const navByRole: Record<Role, { path: string; label: Parameters<typeof t>[1]; icon: typeof Home }[]> = {
  collector: [
    { path: "/dashboard", label: "dashboard", icon: Home },
    { path: "/new-lot", label: "newLot", icon: PackagePlus },
    { path: "/lots", label: "myLots", icon: Boxes },
    { path: "/prices", label: "prices", icon: ChartNoAxesCombined },
    { path: "/recyclers", label: "recyclers", icon: MapPinned },
    { path: "/safety", label: "safety", icon: ShieldCheck },
  ],
  recycler: [
    { path: "/dashboard", label: "dashboard", icon: Home },
    { path: "/lots", label: "requests", icon: Boxes },
    { path: "/prices", label: "prices", icon: ChartNoAxesCombined },
    { path: "/recycler-profile", label: "profile", icon: UserRound },
    { path: "/safety", label: "safety", icon: ShieldCheck },
  ],
  admin: [
    { path: "/dashboard", label: "dashboard", icon: Home },
    { path: "/admin/recyclers", label: "verify", icon: ClipboardCheck },
    { path: "/prices", label: "prices", icon: ChartNoAxesCombined },
    { path: "/admin/data", label: "dataReview", icon: Database },
    { path: "/admin/anomalies", label: "anomalies", icon: Activity },
  ],
};

const routeTitles: Record<string, Parameters<typeof t>[1]> = {
  "/dashboard": "dashboard", "/new-lot": "newLot", "/lots": "myLots", "/prices": "prices",
  "/recyclers": "recyclers", "/safety": "safety", "/recycler-profile": "profile",
  "/admin/recyclers": "verify", "/admin/data": "dataReview", "/admin/anomalies": "anomalies",
};

export function Layout() {
  const { user, signOut, setLanguage } = useAuth();
  const location = useLocation();
  const notify = useToast();
  const language = user?.preferred_language || "en";
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingLanguage, setSyncingLanguage] = useState(false);
  const nav = useMemo(() => user ? navByRole[user.role] : [], [user]);
  const currentLabel = routeTitles[location.pathname] || (location.pathname.startsWith("/lots/") ? "myLots" : "dashboard");
  const title = t(language, currentLabel);

  async function refreshQueue() {
    const queue = await readQueue(user?.id).catch(() => []);
    setPending(queue.length);
  }

  async function syncNow() {
    setSyncing(true);
    const sent = await api.flushQueue().catch(() => 0);
    await refreshQueue();
    setSyncing(false);
    if (sent) {
      window.dispatchEvent(new Event("offline-sync"));
      notify({ title: `${sent} ${t(language, "requestSent").toLowerCase()}`, detail: t(language, "saveSuccess"), kind: "success" });
    } else if (!navigator.onLine) notify({ title: t(language, "offline"), detail: t(language, "offlineNote"), kind: "info" });
  }

  useEffect(() => {
    void api.prices().catch(() => undefined);
    void refreshQueue();
    const onlineHandler = () => { setOnline(true); void syncNow(); };
    const offlineHandler = () => setOnline(false);
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    return () => { window.removeEventListener("online", onlineHandler); window.removeEventListener("offline", offlineHandler); };
  }, []);

  async function changeLanguage(next: Language) {
    setSyncingLanguage(true);
    try {
      await setLanguage(next);
      notify({ title: t(next, "languageSaved"), kind: "success" });
    } catch (error) {
      notify({ title: error instanceof Error ? error.message : t(language, "requestError"), kind: "error" });
    } finally { setSyncingLanguage(false); }
  }

  return <div className="app-frame">
    <aside className="sidebar">
      <NavLink to="/dashboard" className="brand-lockup sidebar-brand"><span className="brand-symbol"><Recycle size={23} /></span><span>Kabadiwala <strong>Connect</strong></span></NavLink>
      <div className="workspace-label">{user?.role === "admin" ? t(language, "navAdmin") : t(language, user?.role === "recycler" ? "recycler" : "collector")}</div>
      <nav className="side-nav" aria-label="Main navigation">
        {nav.map(({ path, label, icon: Icon }) => <NavLink to={path} key={path} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
          <Icon size={18} strokeWidth={1.8} /><span>{t(language, label)}</span>{path === "/admin/data" && undefined}
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-recycle-note"><Sprout size={18} /><div><strong>{t(language, "safeHandling")}</strong><span>{t(language, "footer")}</span></div></div>
        <button className="profile-chip" onClick={() => void signOut()}><span className="avatar">{user?.name.slice(0, 1).toUpperCase()}</span><span className="profile-text"><strong>{user?.name}</strong><small>{user?.role}</small></span><LogOut size={17} aria-hidden="true" /></button>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <div className="topbar-heading"><div className="eyebrow">KABADIWALA CONNECT</div><h1>{title}</h1></div>
        <div className="topbar-actions">
          <div className={`connection-status ${online ? "is-online" : "is-offline"}`} title={online ? t(language, "online") : t(language, "offline")}>
            {online ? <Wifi size={16} /> : <WifiOff size={16} />}<span>{online ? t(language, "online") : t(language, "offline")}</span>
          </div>
          {pending > 0 && <button className="sync-button" onClick={() => void syncNow()} disabled={syncing || !online}>
            {online ? <RefreshCw size={15} className={syncing ? "spin" : ""} /> : <CloudOff size={15} />}
            <span>{syncing ? t(language, "syncing") : `${pending} ${t(language, "pending")}`}</span>
          </button>}
          <label className="language-select top-language"><span className="sr-only">{t(language, "language")}</span>
            <select value={language} disabled={syncingLanguage} onChange={(event) => void changeLanguage(event.target.value as Language)}>
              <option value="en">EN</option><option value="hi">हिन्दी</option><option value="mr">मराठी</option>
            </select>
          </label>
          <span className="top-avatar" title={user?.name}>{user?.name.slice(0, 1).toUpperCase()}</span>
        </div>
      </header>
      <main className="page-content"><Outlet /></main>
      <footer className="page-footer"><span>{t(language, "footer")}</span><span className="footer-safe"><ShieldCheck size={14} />{t(language, "privacy")}</span></footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map(({ path, label, icon: Icon }) => <NavLink to={path} key={path} className={({ isActive }) => `mobile-nav-link ${isActive ? "active" : ""}`}>
          <Icon size={19} /><span>{t(language, label)}</span>
        </NavLink>)}
      </nav>
    </div>
  </div>;
}
