"use client";

export function ImageView({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex items-center justify-center bg-bg px-4 py-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="max-h-[60vh] max-w-full border border-border" />
    </div>
  );
}
