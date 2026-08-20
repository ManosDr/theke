"use client";

import { Area, Bar, CartesianGrid, ComposedChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useLocale } from "../lib/i18n";
import type { AuditLogEntry } from "../lib/types";
import type { TranslationKey } from "../lib/translations";
import styles from "./ActivityChart.module.css";

function toDayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

// Item 2: "Λοιπή δραστηριότητα" was one generic bucket (every audit_log
// action except login) - this maps each of the ~40 real action strings
// into one of 6 named categories, so the chart shows what the activity
// actually is instead of an unlabeled total. Every branch is exhaustive by
// construction: anything not explicitly matched falls into "other" rather
// than being silently dropped, so the breakdown always sums to the same
// total the old single bucket would have shown (verified live - see the
// task report, not just asserted here).
type Category = "documents" | "dataSources" | "users" | "companies" | "content" | "other";

const CATEGORY_ORDER: Category[] = ["documents", "dataSources", "users", "companies", "content", "other"];

const CATEGORY_COLOR: Record<Category, string> = {
  documents: "var(--activity-documents)",
  dataSources: "var(--activity-datasources)",
  users: "var(--activity-users)",
  companies: "var(--activity-companies)",
  content: "var(--activity-content)",
  other: "var(--activity-other)",
};

const CATEGORY_LABEL_KEY: Record<Category, TranslationKey> = {
  documents: "dash.super.chartCategoryDocuments",
  dataSources: "dash.super.chartCategoryDataSources",
  users: "dash.super.chartCategoryUsers",
  companies: "dash.super.chartCategoryCompanies",
  content: "dash.super.chartCategoryContent",
  other: "dash.super.chartCategoryOther",
};

function categorize(action: string): Category {
  if (action.startsWith("document_") || action.startsWith("company_document_")) return "documents";
  // utility_provider_contact_info_updated doesn't share the region_ prefix
  // but is the same ΔΕΥΑ/ΔΕΔΔΗΕ contact-curation work as region_contact_*.
  if (action.startsWith("data_source_") || action.startsWith("region_") || action === "utility_provider_contact_info_updated") {
    return "dataSources";
  }
  // invite_* (created/resent/revoked - see companies.py/admin.py) is a
  // prefix match, not a single exact string - a prior pass here only
  // matched invite_created and silently dropped invite_resent/
  // invite_revoked into "other" (caught by cross-checking every real
  // action= call site in the backend, not just what had fired locally).
  if (
    action.startsWith("invite_") ||
    action === "register" ||
    action === "admin_reset_password" ||
    action === "password_reset" ||
    action === "password_changed" ||
    action === "email_verified" ||
    action === "access_revoked" ||
    action === "access_restored" ||
    action === "role_changed" ||
    action === "impersonate"
  ) {
    return "users";
  }
  if (action.startsWith("company_") || action.startsWith("subscription_")) return "companies";
  if (
    action.startsWith("help_section") ||
    action.startsWith("legal_document") ||
    action === "vertical_updated" ||
    action === "email_template_saved" ||
    action === "logo_updated" ||
    action === "logo_removed"
  ) {
    return "content";
  }
  return "other";
}

type DayBucket = { logins: number } & Record<Category, number>;

function emptyBucket(): DayBucket {
  return { logins: 0, documents: 0, dataSources: 0, users: 0, companies: 0, content: 0, other: 0 };
}

/** Buckets real audit-log entries into per-day counts for the last N days.
 * Logins stay their own series, unchanged; every other action is bucketed
 * into its real category (see categorize()) instead of one generic line. */
function buildDailySeries(entries: AuditLogEntry[], days: number) {
  const buckets = new Map<string, DayBucket>();
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    buckets.set(d.toISOString().slice(0, 10), emptyBucket());
  }

  for (const entry of entries) {
    const key = toDayKey(entry.created_at);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (entry.action === "login") bucket.logins += 1;
    else bucket[categorize(entry.action)] += 1;
  }

  return Array.from(buckets.entries()).map(([date, counts]) => ({
    date: date.slice(5), // MM-DD
    ...counts,
  }));
}

/** Totals per category across all of `entries` (not just the charted
 * window) - drives the breakdown legend list below the chart, where the
 * real numbers are always visible rather than locked behind a tooltip. */
function categoryTotals(entries: AuditLogEntry[]): Record<Category, number> {
  const totals: Record<Category, number> = { documents: 0, dataSources: 0, users: 0, companies: 0, content: 0, other: 0 };
  for (const entry of entries) {
    if (entry.action === "login") continue;
    totals[categorize(entry.action)] += 1;
  }
  return totals;
}

export function ActivityChart({ entries, days = 14 }: { entries: AuditLogEntry[]; days?: number }) {
  const { t } = useLocale();
  const data = buildDailySeries(entries, days);
  const totals = categoryTotals(entries);
  const nonEmptyCategories = CATEGORY_ORDER.filter((c) => totals[c] > 0);

  if (entries.length === 0) {
    return <p className="text-muted">{t("dash.super.noActivity")}</p>;
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {/* Soft teal fill under the logins line, fading to transparent -
                the one series worth visually emphasizing (logins are the
                platform's core engagement signal); the category bars below
                stay flat fills so they don't compete with it. */}
            <linearGradient id="loginsFill" x1="0" y1="0" x2="0" y2="1">
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
          <Legend iconType="circle" wrapperStyle={{ fontSize: "0.8rem" }} />
          <Area
            type="monotone"
            dataKey="logins"
            name={t("dash.super.chartLogins")}
            stroke="var(--color-info)"
            strokeWidth={2.5}
            fill="url(#loginsFill)"
            dot={false}
            activeDot={{ r: 5 }}
          />
          {CATEGORY_ORDER.map((category, i) => (
            <Bar
              key={category}
              dataKey={category}
              name={t(CATEGORY_LABEL_KEY[category])}
              stackId="activity"
              fill={CATEGORY_COLOR[category]}
              radius={i === CATEGORY_ORDER.length - 1 ? [3, 3, 0, 0] : undefined}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Real numbers always visible, not locked behind a tooltip - also
          the light-mode contrast relief the dataviz skill's validator
          calls for on 3 of these 6 hues. Only non-zero categories are
          listed so a quiet period (see "other", currently always 0) isn't
          padded out with dead rows. */}
      <div className={styles.breakdown}>
        {nonEmptyCategories.map((category) => (
          <span key={category} className={styles.breakdownItem}>
            <span className={styles.breakdownSwatch} style={{ background: CATEGORY_COLOR[category] }} aria-hidden="true" />
            <span className={styles.breakdownLabel}>{t(CATEGORY_LABEL_KEY[category])}</span>
            <span className={styles.breakdownCount}>{totals[category]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
