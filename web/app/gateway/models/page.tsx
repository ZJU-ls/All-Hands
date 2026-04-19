import { redirect } from "next/navigation";

export default function LegacyModelsRedirect({
  searchParams,
}: {
  searchParams: { provider?: string };
}) {
  const qs = searchParams.provider
    ? `?provider=${encodeURIComponent(searchParams.provider)}`
    : "";
  redirect(`/gateway${qs}`);
}
