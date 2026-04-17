import { HealthBadge } from "@/components/HealthBadge";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-semibold tracking-tight">allhands</h1>
        <p className="text-text-muted text-sm">
          One for All — open-source digital employee organization platform
        </p>
      </div>
      <HealthBadge />
      <p className="text-text-muted text-xs">
        v0 MVP scaffold · see <code className="font-mono">product/00-north-star.md</code>
      </p>
    </main>
  );
}
