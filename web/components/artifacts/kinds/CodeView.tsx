"use client";

export function CodeView({ content, language }: { content: string; language?: string }) {
  const lines = content.replace(/\n$/, "").split("\n");
  const width = String(lines.length).length;
  return (
    <div className="border-t border-border bg-bg">
      {language && (
        <div className="px-3 py-1.5 border-b border-border font-mono text-[10px] uppercase tracking-wider text-text-muted">
          {language}
        </div>
      )}
      <pre className="overflow-x-auto text-xs font-mono leading-relaxed py-2">
        <code className="block">
          {lines.map((line, i) => (
            <span key={i} className="flex">
              <span
                className="select-none pl-3 pr-3 text-right text-text-subtle"
                style={{ minWidth: `${width + 2}ch` }}
              >
                {i + 1}
              </span>
              <span className="pr-3 whitespace-pre text-text">{line || " "}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
