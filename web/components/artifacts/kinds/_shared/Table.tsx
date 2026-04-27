"use client";

/**
 * Shared table component for csv + xlsx viewers.
 * Brand Blue Dual Theme · sticky header · row-zebra · horizontal scroll.
 */

export function ArtifactTable({
  headers,
  rows,
  emptyMessage,
}: {
  headers: string[];
  rows: (string | number | boolean | null)[][];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-[12px] text-text-muted">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="overflow-auto" style={{ maxHeight: "60vh" }}>
      <table className="min-w-full text-[12px]">
        <thead className="sticky top-0 z-10 bg-surface-2 backdrop-blur">
          <tr>
            {headers.map((h, i) => (
              <th
                key={`${i}-${h}`}
                className="border-b border-border px-3 py-2 text-left font-semibold text-text-muted whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr
              key={r}
              className={r % 2 === 0 ? "bg-surface" : "bg-surface-2/40"}
            >
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border-b border-border/40 px-3 py-1.5 align-top text-text"
                >
                  {cell == null ? "" : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
