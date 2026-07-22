import type { ReactNode } from "react";
import { AlertCircle, ArrowRight, LoaderCircle } from "lucide-react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "good" | "warning" | "accent";
}) {
  return (
    <article className="metric-card" data-tone={tone}>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

export function LoadingState({ label = "正在读取本机数据…" }: { label?: string }) {
  return (
    <div className="center-state" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{label}</p>
    </div>
  );
}

function readableLocalError(message: string): string {
  if (/failed to fetch|load failed|network ?error|network request failed/iu.test(message)) {
    return "无法连接本机服务。请确认 SymType 仍在运行，然后重试。";
  }
  return message;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="center-state center-state--error" role="alert">
      <AlertCircle size={26} />
      <h2>本地服务暂时没有回应</h2>
      <p>{readableLocalError(message)}</p>
      {onRetry ? (
        <button className="button button--secondary" type="button" onClick={onRetry}>
          重试 <ArrowRight size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__mark" aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            type="button"
            aria-pressed={option.value === value}
            className={option.value === value ? "is-active" : ""}
            onClick={() => onChange(option.value)}
            key={option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
