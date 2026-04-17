import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "allhands",
  description: "One for All — open-source digital employee organization platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
        {children}
      </body>
    </html>
  );
}
