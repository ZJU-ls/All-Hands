"use client";

import Link from "next/link";

type Action = { label: string; href?: string; onClick?: () => void; danger?: boolean };

export function QuickActions({
  paused,
  onPause,
  onResume,
}: {
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  const actions: Action[] = [
    { label: "+ 新对话", href: "/chat" },
    { label: "+ 新员工", href: "/employees" },
    { label: "+ 新触发器", href: "/triggers" },
    paused
      ? { label: "恢复运行", onClick: onResume }
      : { label: "急停所有 run", onClick: onPause, danger: true },
  ];
  return (
    <section className="flex flex-col min-h-0">
      <header className="flex items-center justify-between h-8 px-3 border-b border-border">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
          快速操作
        </span>
      </header>
      <ul className="divide-y divide-border">
        {actions.map((a) => {
          const baseCls =
            "flex items-center justify-between h-8 px-3 text-[12px] transition-colors duration-base";
          const hoverCls = a.danger
            ? "text-danger hover:bg-danger/10"
            : "text-text hover:bg-surface-2";
          const content = (
            <div className={`${baseCls} ${hoverCls}`}>
              <span>{a.label}</span>
              <span className="font-mono text-[10px] text-text-subtle">→</span>
            </div>
          );
          return (
            <li key={a.label}>
              {a.href ? (
                <Link href={a.href} className="block">
                  {content}
                </Link>
              ) : (
                <button type="button" onClick={a.onClick} className="w-full text-left">
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
