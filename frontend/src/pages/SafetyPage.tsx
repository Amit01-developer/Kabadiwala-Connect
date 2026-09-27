import { BadgeCheck, BatteryWarning, Database, FileCheck2, Flame, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { PageHeading } from "../components/ui";
import { t } from "../i18n";

export function SafetyPage() {
  const { user } = useAuth();
  const language = user?.preferred_language || "en";
  const items = [
    { icon: BatteryWarning, title: t(language, "safetyOne"), tag: "01", color: "orange" },
    { icon: BadgeCheck, title: t(language, "safetyTwo"), tag: "02", color: "green" },
    { icon: FileCheck2, title: t(language, "safetyThree"), tag: "03", color: "blue" },
    { icon: Database, title: t(language, "safetyFour"), tag: "04", color: "purple" },
  ];
  return <div className="page-stack">
    <PageHeading eyebrow={t(language, "safety")} title={t(language, "safetyTitle")} description={t(language, "safeHandling")} />
    <div className="safety-banner"><span className="safety-symbol"><Flame size={23} /></span><div><strong>{t(language, "acceptTerms")}</strong><p>{t(language, "safetyOne")}</p></div></div>
    <div className="safety-grid">{items.map(({ icon: Icon, title, tag, color }) => <article className="safety-item" key={tag}><span className={`safety-item-icon tint-${color}`}><Icon size={22} /></span><span className="safety-number">{tag}</span><p>{title}</p></article>)}</div>
    <div className="notice-banner notice-info"><ShieldCheck size={18} /><span>{t(language, "privacy")}</span></div>
  </div>;
}
