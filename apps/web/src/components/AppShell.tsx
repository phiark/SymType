import { Suspense, useEffect, useRef, useState, type RefObject } from "react";
import {
  BarChart3,
  CalendarDays,
  Gamepad2,
  Keyboard,
  Menu,
  Settings,
  TimerReset,
  X
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import type { BootstrapData } from "../types";
import { LoadingState } from "./ui";

const navigation = [
  { to: "/", label: "今日", icon: CalendarDays, end: true },
  { to: "/train", label: "训练", icon: Keyboard, end: false },
  { to: "/test", label: "测试", icon: TimerReset, end: false },
  { to: "/game", label: "游戏", icon: Gamepad2, end: false },
  { to: "/analytics", label: "分析", icon: BarChart3, end: false },
  { to: "/settings", label: "设置", icon: Settings, end: false }
] as const;

function RouteContent({
  bootstrap,
  mainRef
}: {
  bootstrap: BootstrapData;
  mainRef: RefObject<HTMLElement | null>;
}) {
  const location = useLocation();
  useEffect(() => {
    // Run inside Suspense so the destination, including hash targets, is mounted first.
    const frame = window.requestAnimationFrame(() => {
      const anchor = location.hash ? document.getElementById(location.hash.slice(1)) : null;
      mainRef.current?.focus({ preventScroll: true });
      if (anchor) anchor.scrollIntoView({ behavior: "instant", block: "start" });
      else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, mainRef]);
  return <Outlet context={{ bootstrap }} />;
}

export function AppShell({ bootstrap }: { bootstrap: BootstrapData }) {
  const location = useLocation();
  const focused = location.pathname.includes("/session") || location.pathname.includes("/play");
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menuOpen = menuPath === location.pathname;
  const mainRef = useRef<HTMLElement>(null);

  if (focused) {
    return (
      <div className="focus-shell">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <header className="focus-shell__header">
          <div className="wordmark" aria-label="SymType 专注模式">
            <span className="wordmark__symbol">S</span>
            <span>SymType</span>
          </div>
        </header>
        <main id="main-content" ref={mainRef} tabIndex={-1}>
          <Suspense fallback={<LoadingState label="正在打开页面…" />}>
            <RouteContent bootstrap={bootstrap} mainRef={mainRef} />
          </Suspense>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="mobile-header">
        <NavLink to="/" className="wordmark">
          <span className="wordmark__symbol">S</span>
          <span>SymType</span>
        </NavLink>
        <button
          className="icon-button"
          type="button"
          onClick={() => setMenuPath(menuOpen ? null : location.pathname)}
          aria-label={menuOpen ? "关闭导航" : "打开导航"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      </header>
      <aside className={`sidebar${menuOpen ? " is-open" : ""}`}>
        <NavLink to="/" className="wordmark" aria-label="SymType 今日页面">
          <span className="wordmark__symbol">S</span>
          <span>SymType</span>
        </NavLink>
        <nav aria-label="主要导航">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink to={to} end={end} key={to} onClick={() => setMenuPath(null)}>
              <Icon size={19} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="local-badge">
            <span />
            仅存本机
          </div>
          <p>数据保存在这台电脑</p>
        </div>
      </aside>
      <main id="main-content" ref={mainRef} className="main-content" tabIndex={-1}>
        <Suspense fallback={<LoadingState label="正在打开页面…" />}>
          <RouteContent bootstrap={bootstrap} mainRef={mainRef} />
        </Suspense>
      </main>
    </div>
  );
}
