"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AuditLogEntry } from "../lib/types";

function toDayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

/** Buckets real audit-log entries into a per-day count for the last N days -
 * no synthetic/placeholder data, this is exactly what happened. */
function buildDailyCounts(entries: AuditLogEntry[], days: number) {
  const buckets = new Map<string, number>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const entry of entries) {
    const key = toDayKey(entry.created_at);
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([date, count]) => ({
    date: date.slice(5), // MM-DD
    events: count,
  }));
}

export function ActivityChart({ entries, days = 14 }: { entries: AuditLogEntry[]; days?: number }) {
  const data = buildDailyCounts(entries, days);

  if (entries.length === 0) {
    return <p className="text-muted">No activity recorded yet.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={12} />
        <YAxis allowDecimals={false} stroke="var(--color-text-muted)" fontSize={12} />
        <Tooltip
          contentStyle={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-text)",
          }}
        />
        <Bar dataKey="events" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
