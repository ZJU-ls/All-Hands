import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
    // `data-theme-pack` is the extensibility axis — see ADR 0016 §D7.
    // The `.light` / `.dark` class is managed by next-themes via ThemeProvider.
    // `suppressHydrationWarning` is required for next-themes (it mutates
    // <html> before React hydrates).
    <html
      lang="en"
      data-theme-pack="brand-blue"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="h-screen overflow-hidden" suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
