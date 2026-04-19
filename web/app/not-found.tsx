import Link from "next/link";

export default function NotFound() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-bg text-text p-8">
      <div className="max-w-md w-full rounded-xl border border-border bg-surface p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-subtle mb-2">
          404 · not found
        </p>
        <h2 className="text-lg font-semibold tracking-tight mb-2">页面不存在</h2>
        <p className="text-[12px] text-text-muted mb-4">这个地址没有对应的页面。</p>
        <Link
          href="/chat"
          className="inline-flex items-center rounded bg-primary hover:bg-primary-hover text-primary-fg text-[12px] font-medium px-3 py-1.5 transition-colors duration-base"
        >
          返回对话
        </Link>
      </div>
    </div>
  );
}
