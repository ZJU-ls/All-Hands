"use client";

/**
 * FirstRun · 首次访问引导(驾驶舱零态 / 首次打开某个工作区)
 *
 * Visual contract:
 * - "欢迎 + 3 步清单 + 一个主 CTA"模板。禁止 icon 库,列表前缀用 mono `·`。
 * - 主容器用 border-border + bg-surface · primary 色仅保留在激活色条 + CTA 按钮。
 * - 步骤项可选 done 态:mono `✓` + text-success(token)。
 */

export type FirstRunStep = {
  title: string;
  description?: string;
  done?: boolean;
};

export function FirstRun({
  title,
  description,
  steps,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  description?: string;
  steps: FirstRunStep[];
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
}) {
  return (
    <section
      role="region"
      aria-label="首次使用引导"
      data-state="first-run"
      className="relative rounded-md border border-border bg-surface px-6 py-5"
    >
      <span
        aria-hidden="true"
        className="absolute left-0 top-4 bottom-4 w-[2px] rounded-r bg-primary"
      />
      <div className="pl-3">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
          first-run · 欢迎
        </div>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-text">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[12px] text-text-muted">{description}</p>
        )}
        <ol className="mt-4 space-y-2">
          {steps.map((step, i) => (
            <li key={`${i}-${step.title}`} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className={`font-mono text-[11px] leading-5 shrink-0 ${
                  step.done ? "text-success" : "text-text-subtle"
                }`}
              >
                {step.done ? "✓" : `${i + 1}.`}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-text">{step.title}</p>
                {step.description && (
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    {step.description}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        {(primaryAction || secondaryAction) && (
          <div className="mt-5 flex items-center gap-2">
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="rounded bg-primary hover:bg-primary-hover text-primary-fg text-[12px] font-medium px-3 py-1.5 transition-colors duration-base"
              >
                {primaryAction.label}
              </button>
            )}
            {secondaryAction && (
              <button
                type="button"
                onClick={secondaryAction.onClick}
                className="rounded border border-border hover:border-border-strong hover:bg-surface-2 text-text-muted hover:text-text text-[12px] px-3 py-1.5 transition-colors duration-base"
              >
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
