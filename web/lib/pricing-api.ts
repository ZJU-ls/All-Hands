const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export type PriceRowDto = {
  model_ref: string;
  input_per_million_usd: number;
  output_per_million_usd: number;
  source: "code" | "db";
  source_url: string | null;
  note: string | null;
  updated_at: string | null;
  updated_by_run_id: string | null;
};

export type PriceListResponse = {
  prices: PriceRowDto[];
  count: number;
  db_count: number;
  code_count: number;
};

export async function fetchModelPrices(): Promise<PriceListResponse> {
  const res = await fetch(`${BASE}/api/pricing/models`, { cache: "no-store" });
  if (!res.ok) throw new Error(`pricing list failed: ${res.status}`);
  return res.json() as Promise<PriceListResponse>;
}

export async function upsertModelPrice(
  modelRef: string,
  body: {
    input_per_million_usd: number;
    output_per_million_usd: number;
    source_url: string;
    note?: string;
  },
): Promise<PriceRowDto> {
  const res = await fetch(
    `${BASE}/api/pricing/models/${encodeURIComponent(modelRef)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`pricing upsert failed: ${res.status}`);
  return res.json() as Promise<PriceRowDto>;
}

export async function deleteModelPriceOverride(
  modelRef: string,
): Promise<{ model_ref: string; removed: boolean }> {
  const res = await fetch(
    `${BASE}/api/pricing/models/${encodeURIComponent(modelRef)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`pricing delete failed: ${res.status}`);
  return res.json();
}
