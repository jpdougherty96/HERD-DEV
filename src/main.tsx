
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import App from "./App.tsx";
import "./globals.css";

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded">
      <p className="font-semibold">Something went wrong.</p>
      <p className="text-sm">{error.message}</p>
    </div>
  );
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
