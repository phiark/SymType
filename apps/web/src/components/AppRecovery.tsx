import { RefreshCw } from "lucide-react";

/** Keep render and stale-asset failures actionable without exposing errors or user content. */
export function AppRecovery() {
  return (
    <main className="center-state center-state--error" role="alert">
      <h1>这个页面暂时无法打开</h1>
      <p>请重新打开页面。已保存的记录仍在这台电脑，未保存的更改可能需要重新操作。</p>
      <p>如果仍无法打开，可返回今日继续练习，或重启 SymType 后再试。</p>
      <div className="dialog-actions">
        <a className="button button--secondary" href="/">
          返回今日
        </a>
        <button
          className="button button--primary"
          type="button"
          onClick={() => window.location.reload()}
        >
          <RefreshCw size={18} aria-hidden="true" /> 重新打开页面
        </button>
      </div>
    </main>
  );
}
