import { useId } from "react";
import { KEYBOARD_ROWS, type KeyDefinition } from "@symtype/shared";

interface Feature {
  feature_type: string;
  feature_value: string;
  sample_count: number;
  accuracy: number;
  short_iki_ms: number | null;
}

export function KeyboardHeatmap({
  features,
  layout
}: {
  features: Feature[];
  layout: readonly KeyDefinition[];
}) {
  const summaryId = useId();
  const byKey = new Map(
    features
      .filter((feature) => feature.feature_type === "key")
      .map((feature) => [feature.feature_value.toLowerCase(), feature])
  );
  const observed = [...byKey.values()];
  const weakest = [...observed].sort(
    (first, second) => first.accuracy - second.accuracy || second.sample_count - first.sample_count
  )[0];
  const summary = observed.length
    ? `覆盖 ${observed.length} 个字符、共 ${observed.reduce((sum, feature) => sum + feature.sample_count, 0)} 个样本。${weakest ? `当前最低准确率为 ${weakest.feature_value === " " ? "Space" : weakest.feature_value}，${Math.round(weakest.accuracy * 100)}%。` : ""}`
    : "当前没有字符样本。";
  return (
    <div className="heatmap">
      <p className="heatmap-summary" id={summaryId}>
        {summary}
      </p>
      <div
        className="heatmap-table"
        role="table"
        tabIndex={0}
        aria-label="逐键准确率和样本量"
        aria-describedby={summaryId}
      >
        {KEYBOARD_ROWS.map((rowName) => {
          const row = layout.filter((key) => key.row === rowName);
          if (!row.length) return null;
          return (
            <div className="heatmap-row" role="row" key={rowName}>
              {row.map((key) => {
                const printable = key.unshifted ?? "";
                const feature = printable ? byKey.get(printable.toLowerCase()) : undefined;
                const accuracy = feature?.accuracy ?? 0;
                const sampleConfidence = Math.min(1, (feature?.sample_count ?? 0) / 30);
                const weakness = feature ? 1 - accuracy : 0;
                const hue = feature ? 142 - weakness * 130 : 215;
                return (
                  <div
                    className={`heatmap-key ${feature ? "heatmap-key-observed" : "heatmap-key-empty"}`}
                    role="cell"
                    key={key.code}
                    style={{
                      flexGrow: key.width,
                      flexBasis: `${key.width * 33}px`,
                      backgroundColor: feature
                        ? `hsl(${hue} 62% ${94 - sampleConfidence * 25}%)`
                        : "var(--surface-muted)"
                    }}
                    title={
                      feature
                        ? `${printable}: ${Math.round(accuracy * 100)}% · ${feature.sample_count} 样本`
                        : `${printable || key.code}: 样本不足`
                    }
                    aria-label={
                      feature
                        ? `${printable || key.code}，准确率 ${Math.round(accuracy * 100)}%，${feature.sample_count} 个样本`
                        : `${printable || key.code}，样本不足`
                    }
                  >
                    <strong>{printable || key.code.replace(/^(Key|Digit)/u, "")}</strong>
                    <small>{feature ? `${Math.round(accuracy * 100)}%` : "—"}</small>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="heatmap-legend">
        <span>样本不足</span>
        <i aria-hidden="true" />
        <span>需关注</span>
        <i aria-hidden="true" />
        <span>稳定</span>
      </div>
    </div>
  );
}
