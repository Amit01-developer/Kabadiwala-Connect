import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Check, Info, LoaderCircle, type LucideIcon } from "lucide-react";
import type { Language, Material, LotStatus } from "../types";
import { materialLabel, t } from "../i18n";

type ToastKind = "success" | "error" | "info";
interface ToastInput { title: string; detail?: string; kind?: ToastKind }
interface ToastValue { notify: (message: ToastInput) => void }
const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<(ToastInput & { id: number })[]>([]);
  const notify = (message: ToastInput) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { ...message, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4600);
  };
  const value = useMemo(() => ({ notify }), []);
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.kind === "error" ? AlertCircle : toast.kind === "success" ? Check : Info;
        return <div className={`toast toast-${toast.kind || "info"}`} role={toast.kind === "error" ? "alert" : "status"} key={toast.id}>
          <Icon size={18} aria-hidden="true" />
          <div><strong>{toast.title}</strong>{toast.detail && <span>{toast.detail}</span>}</div>
        </div>;
      })}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value.notify;
}

export function Button({ children, icon: Icon, variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "quiet" | "danger" | "outline";
}) {
  return <button className={`button button-${variant} ${className}`} {...props}>
    {Icon && <Icon size={17} strokeWidth={1.9} aria-hidden="true" />}{children}
  </button>;
}

export function IconButton({ label, icon: Icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: LucideIcon }) {
  return <button className="icon-button" aria-label={label} title={label} {...props}><Icon size={18} aria-hidden="true" /></button>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading">
    <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="page-heading-action">{action}</div>}
  </div>;
}

export function Stat({ label, value, detail, icon: Icon, tint = "green" }: { label: string; value: string | number; detail?: string; icon: LucideIcon; tint?: "green" | "orange" | "blue" | "purple" }) {
  return <div className="stat-card">
    <div className={`stat-icon tint-${tint}`}><Icon size={19} aria-hidden="true" /></div>
    <div className="stat-copy"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>
  </div>;
}

export function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={22} /></div><strong>{title}</strong>{detail && <p>{detail}</p>}{action}</div>;
}

export function StatusBadge({ status, language }: { status: LotStatus | string; language: Language }) {
  const known = ["requested", "accepted", "scheduled", "handed_over", "paid", "declined", "sync_pending"].includes(status);
  const label = known ? t(language, `status_${status}` as Parameters<typeof t>[1]) : status.replaceAll("_", " ");
  return <span className={`status-badge status-${status}`}>{label}</span>;
}

export function MaterialTile({ material, language, selected, onClick }: { material: Material; language: Language; selected?: boolean; onClick?: () => void }) {
  const symbol: Record<Material, string> = { mobile: "01", laptop: "02", tv: "03", battery: "04", printer: "05", other: "06" };
  return <button className={`material-tile ${selected ? "is-selected" : ""}`} onClick={onClick} type="button">
    <span className={`material-mark material-${material}`} aria-hidden="true"><span>{symbol[material]}</span></span>
    <span>{materialLabel(language, material)}</span>
  </button>;
}

export function LoadingState({ label }: { label: string }) {
  return <div className="loading-state"><LoaderCircle size={20} className="spin" />{label}</div>;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="error-banner" role="alert"><AlertCircle size={18} />{children}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small className="field-hint">{hint}</small>}</label>;
}

export function formatMoney(amount: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(value: string | null | undefined, language: Language) {
  if (!value) return "—";
  const locale = language === "hi" ? "hi-IN" : language === "mr" ? "mr-IN" : "en-IN";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
