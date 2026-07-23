"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useLocale } from "../lib/i18n";

function toDayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Buckets the company's own chat-session timestamps (already scoped/filtered
 * server-side, see CompanyOverviewResponse.messages_last_14d) into per-day
 * counts - the same client-side bucketing pattern ActivityChart uses for the
 * platform-wide audit log, just single-series since there's no cross-tenant
 * "other activity" category to split out at this scope. */
function buildDailySeries(timestamps: string[], days: number) {
  const buckets = new Map<string, number>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const ts of timestamps) {
    const key = toDayKey(ts);
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets.entries()).map(([date, count]) => ({ date: date.slice(5), count }));
}

export function CompanyActivityChart({ messages, days = 14 }: { messages: string[]; days?: number }) {
  const { t } = useLocale();
  const data = buildDailySeries(messages, days);

  if (messages.length === 0) {
    return <p className="text-muted">{t("dash.company.activityEmpty")}</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="companyMessagesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <Area
          type="monotone"
          dataKey="count"
          name={t("dash.company.chartTitle")}
          stroke="var(--color-info)"
          strokeWidth={2.5}
          fill="url(#companyMessagesFill)"
          dot={false}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
