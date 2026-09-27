import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { LoadingState, ToastProvider } from "./components/ui";
const AuthPage = lazy(() => import("./pages/AuthPage").then((module) => ({ default: module.AuthPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const NewLotPage = lazy(() => import("./pages/NewLotPage").then((module) => ({ default: module.NewLotPage })));
const LotsPage = lazy(() => import("./pages/LotsPage").then((module) => ({ default: module.LotsPage })));
const LotDetailPage = lazy(() => import("./pages/LotDetailPage").then((module) => ({ default: module.LotDetailPage })));
const PricesPage = lazy(() => import("./pages/PricesPage").then((module) => ({ default: module.PricesPage })));
const RecyclersPage = lazy(() => import("./pages/RecyclersPage").then((module) => ({ default: module.RecyclersPage })));
const RecyclerProfilePage = lazy(() => import("./pages/RecyclerProfilePage").then((module) => ({ default: module.RecyclerProfilePage })));
const AdminRecyclersPage = lazy(() => import("./pages/AdminRecyclersPage").then((module) => ({ default: module.AdminRecyclersPage })));
const DataReviewPage = lazy(() => import("./pages/DataReviewPage").then((module) => ({ default: module.DataReviewPage })));
const AnomaliesPage = lazy(() => import("./pages/AnomaliesPage").then((module) => ({ default: module.AnomaliesPage })));
const SafetyPage = lazy(() => import("./pages/SafetyPage").then((module) => ({ default: module.SafetyPage })));
import type { Role } from "./types";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <main className="auth-loading"><LoadingState label="Loading account…" /></main>;
  return user ? <Outlet /> : <Navigate to="/sign-in" replace />;
}

function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  return user && roles.includes(user.role) ? children : <Navigate to="/dashboard" replace />;
}

function AppRoutes() {
  const { user } = useAuth();
  return <Suspense fallback={<main className="auth-loading"><LoadingState label="Loading workspace..." /></main>}><Routes>
    <Route path="/sign-in" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
    <Route element={<RequireAuth />}>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="lots" element={<LotsPage />} />
        <Route path="lots/:lotId" element={<LotDetailPage />} />
        <Route path="prices" element={<PricesPage />} />
        <Route path="safety" element={<SafetyPage />} />
        <Route path="new-lot" element={<RequireRole roles={["collector"]}><NewLotPage /></RequireRole>} />
        <Route path="recyclers" element={<RequireRole roles={["collector"]}><RecyclersPage /></RequireRole>} />
        <Route path="recycler-profile" element={<RequireRole roles={["recycler"]}><RecyclerProfilePage /></RequireRole>} />
        <Route path="admin/recyclers" element={<RequireRole roles={["admin"]}><AdminRecyclersPage /></RequireRole>} />
        <Route path="admin/data" element={<RequireRole roles={["admin"]}><DataReviewPage /></RequireRole>} />
        <Route path="admin/anomalies" element={<RequireRole roles={["admin"]}><AnomaliesPage /></RequireRole>} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to={user ? "/dashboard" : "/sign-in"} replace />} />
  </Routes></Suspense>;
}

export default function App() {
  return <ToastProvider><BrowserRouter><AppRoutes /></BrowserRouter></ToastProvider>;
}

export function ServiceWorkerRegistration() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(() => setReady(true)).catch(() => setReady(false));
  }, []);
  return <span className="sr-only" aria-live="polite">{ready ? "Offline access ready" : ""}</span>;
}
