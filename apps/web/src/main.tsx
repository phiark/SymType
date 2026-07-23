import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { App } from "./App";
import { installDesktopLifecycleBridge } from "./desktop-lifecycle";
import { installWebPerformanceProbe } from "./performance-probe";
import "./styles.css";

const performanceProbe = installWebPerformanceProbe();
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
    mutations: { retry: 0 }
  }
});

const root = document.getElementById("root");
if (!root) throw new Error("SymType root element is missing");

installDesktopLifecycleBridge();

// A data router is required for useBlocker. App keeps its declarative route
// tree so bootstrap/loading/error ownership remains in one place.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>
);
performanceProbe.markReactRenderSubmitted();
