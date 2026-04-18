import { NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ employeeId: string }> },
): Promise<Response> {
  const { employeeId } = await ctx.params;
  const res = await fetch(`${BACKEND}/api/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employee_id: employeeId }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: `backend returned ${res.status}`, detail },
      { status: res.status },
    );
  }
  const { id } = (await res.json()) as { id: string };
  return NextResponse.redirect(new URL(`/chat/${id}`, _req.url), 303);
}
