"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useLocale } from "../lib/i18n";
import type { AuditLogEntry } from "../lib/types";

function toDayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

/** Buckets real audit-log entries into per-day counts for the last N days,
 * split into two honest categories (logins vs. everything else) so the
 * chart reads as a multi-series line chart - no synthetic data, this is
 * exactly what happened, just grouped by what kind of action it was. */
function buildDailySeries(entries: AuditLogEntry[], days: number) {
  const buckets = new Map<string, { logins: number; activity: number }>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), { logins: 0, activity: 0 });
  }

  for (const entry of entries) {
    const key = toDayKey(entry.created_at);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (entry.action === "login") bucket.logins += 1;
    else bucket.activity += 1;
  }

  return Array.from(buckets.entries()).map(([date, counts]) => ({
    date: date.slice(5), // MM-DD
    ...counts,
  }));
}

export function ActivityChart({ entries, days = 14 }: { entries: AuditLogEntry[]; days?: number }) {
  const { t } = useLocale();
  const data = buildDailySeries(entries, days);

  if (entries.length === 0) {
    return <p className="text-muted">{t("dash.super.noActivity")}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-text)",
          }}
        />
        <Legend
          iconType="circle"
          formatter={(value) => <span style={{ color: "var(--color-text-muted)" }}>{value}</span>}
        />
        <Line
          type="monotone"
          dataKey="logins"
          name={t("dash.super.chartLogins")}
          stroke="var(--color-info)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
        <Line
          type="monotone"
          dataKey="activity"
          name={t("dash.super.chartOtherActivity")}
          stroke="var(--color-primary)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
