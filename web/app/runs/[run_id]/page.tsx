import { redirect } from "next/navigation";

/**
 * Legacy `/runs/[run_id]` route — preserved as a redirect after trace
 * viewing was consolidated into `/observatory/runs/[run_id]` (the
 * observatory L3 detail page). External links / bookmarks / agent
 * outputs that still point here keep working; we'll watch usage and
 * delete the redirect in a follow-up once the legacy path goes quiet.
 */
export default async function LegacyRunDetailRedirect({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id } = await params;
  redirect(`/observatory/runs/${encodeURIComponent(run_id)}`);
}
