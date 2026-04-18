"use client";

export function HtmlView({ content }: { content: string }) {
  return (
    <iframe
      className="h-[60vh] w-full border-0 bg-bg"
      sandbox=""
      srcDoc={content}
      title="artifact-html"
    />
  );
}
