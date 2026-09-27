import React from "react";
import ReactDOM from "react-dom/client";
import App, { ServiceWorkerRegistration } from "./App";
import { AuthProvider } from "./auth";
import "leaflet/dist/leaflet.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider><ServiceWorkerRegistration /><App /></AuthProvider>
  </React.StrictMode>,
);
