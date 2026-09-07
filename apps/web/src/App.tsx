import { lazy, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { api } from "./api";
import { soundEngine } from "./audio";
import { AppShell } from "./components/AppShell";
import { ErrorState, LoadingState } from "./components/ui";
import { OnboardingPage } from "./pages/OnboardingPage";

const AnalyticsPage = lazy(() =>
  import("./pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage }))
);
const GamePage = lazy(() =>
  import("./pages/GamePage").then((module) => ({ default: module.GamePage }))
);
const PracticePage = lazy(() =>
  import("./pages/PracticePage").then((module) => ({ default: module.PracticePage }))
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);
const TestsPage = lazy(() =>
  import("./pages/TestsPage").then((module) => ({ default: module.TestsPage }))
);
const TodayPage = lazy(() =>
  import("./pages/TodayPage").then((module) => ({ default: module.TodayPage }))
);
const TrainPage = lazy(() =>
  import("./pages/TrainPage").then((module) => ({ default: module.TrainPage }))
);

export function App() {
  const bootstrapQuery = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.bootstrap(),
    staleTime: 30_000,
    retry: 2
  });

  const settings = bootstrapQuery.data?.settings;
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
    soundEngine.configure(settings);
  }, [settings]);

  if (bootstrapQuery.isLoading) return <LoadingState label="正在打开你的本机训练档案…" />;
  if (bootstrapQuery.isError || !bootstrapQuery.data) {
    return (
      <ErrorState error={bootstrapQuery.error} onRetry={() => void bootstrapQuery.refetch()} />
    );
  }

  if (!bootstrapQuery.data.settings.onboardingComplete) {
    return <OnboardingPage bootstrap={bootstrapQuery.data} />;
  }

  return (
    <Routes>
      <Route element={<AppShell bootstrap={bootstrapQuery.data} />}>
        <Route index element={<TodayPage />} />
        <Route path="train" element={<TrainPage />} />
        <Route path="train/session" element={<PracticePage />} />
        <Route path="test" element={<TestsPage />} />
        <Route path="test/session" element={<PracticePage kind="test" />} />
        <Route path="game" element={<GamePage />} />
        <Route path="game/play" element={<GamePage play />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="settings/*" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
