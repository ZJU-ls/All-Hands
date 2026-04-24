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
  title: {
    default: "allhands · 数字员工组织平台",
    template: "%s · allhands",
  },
  description:
    "与 Lead Agent 对话,设计、调度、观测你的数字员工团队。开源自部署,Tool First 架构。",
  applicationName: "allhands",
  keywords: [
    "AI agent",
    "digital employee",
    "agent orchestration",
    "LangGraph",
    "Claude",
    "open source",
  ],
  openGraph: {
    type: "website",
    title: "allhands · 数字员工组织平台",
    description:
      "One Lead Agent, a team of employees. 对话即编排,UI 即观测。",
    siteName: "allhands",
  },
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
