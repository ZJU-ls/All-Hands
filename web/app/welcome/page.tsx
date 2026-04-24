import type { Metadata } from "next";
import { WelcomeScreen } from "@/components/welcome/WelcomeScreen";

export const metadata: Metadata = {
  title: "欢迎",
  description:
    "allhands — 与 Lead Agent 对话,组建你的数字员工团队。",
};

export default function WelcomePage() {
  return <WelcomeScreen />;
}
