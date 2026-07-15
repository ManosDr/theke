"use client";

import { useEffect, useMemo, useState } from "react";

import { StatCard } from "../dashboard/StatCard";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { TranslationKey } from "../lib/translations";
import type {
  CompanySummary,
  PlanSummary,
  SubscriptionEntry,
  SubscriptionListResponse,
  VerticalSummary,
} from "../lib/types";
import { AlertIcon, ClockIcon, ShieldCheckIcon, UsersIcon } from "./StatIcons";
import dashStyles from "../dashboard/dashboard.module.css";
import styles from "./SubscriptionsPanel.module.css";

const STATUS_BADGE_CLASS: Record<string, string> = {
  trial: styles["status-trial"],
  active: styles["status-active"],
  expired: styles["status-expired"],
  cancelled: styles["status-cancelled"],
  suspended: styles["status-suspended"],
};

type Tab = "companies" | "plans";

export function SubscriptionsPanel() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("companies");

  return (
    <div>
      <h1>{t("adminSubs.title")}</h1>

      <div className={styles.tabBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "companies"}
          className={`${styles.tabButton} ${tab === "companies" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("companies")}
        >
          {t("adminSubs.tabCompanies")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "plans"}
          className={`${styles.tabButton} ${tab === "plans" ? styles.tabButtonActive : ""}`}
          onClick={() => setTab("plans")}
        >
          {t("adminSubs.tabPlans")}
        </button>
      </div>

      {tab === "companies" ? <CompaniesTab /> : <PlansTab />}
    </div>
  );
}

function CompaniesTab() {
  const { user } = useAuth();
  const { t, tUpper, locale } = useLocale();
  const token = user?.token ?? null;

  const [items, setItems] = useState<SubscriptionEntry[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [changePlanTarget, setChangePlanTarget] = useState<SubscriptionEntry | null>(null);
  const [notesTarget, setNotesTarget] = useState<SubscriptionEntry | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      const [subData, planData] = await Promise.all([
        api.get<SubscriptionListResponse>("/admin/subscriptions", token),
        api.get<PlanSummary[]>("/admin/plans", token),
      ]);
      setItems(subData.items);
      setPlans(planData);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const counts = useMemo(
    () => ({
      trial: items.filter((i) => i.status === "trial").length,
      active: items.filter((i) => i.status === "active").length,
      expired: items.filter((i) => i.status === "expired").length,
      cancelled: items.filter((i) => i.status === "cancelled").length,
    }),
    [items]
  );

  async function extendTrial(item: SubscriptionEntry) {
    const daysStr = window.prompt(t("adminSubs.extendTrialPrompt"));
    if (!daysStr) return;
    const days = Number(daysStr);
    if (!Number.isFinite(days) || days <= 0) return;
    await api.patch(`/admin/subscriptions/${item.company_id}/extend-trial`, { days }, token);
    setOpenMenuId(null);
    refresh();
  }

  async function cancelSub(item: SubscriptionEntry) {
    await api.patch(`/admin/subscriptions/${item.company_id}/cancel`, undefined, token);
    setOpenMenuId(null);
    refresh();
  }

  async function reactivateSub(item: SubscriptionEntry) {
    await api.patch(`/admin/subscriptions/${item.company_id}/reactivate`, undefined, token);
    setOpenMenuId(null);
    refresh();
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <div className={dashStyles.grid} style={{ marginBottom: "var(--space-4)" }}>
        <StatCard tone="primary" icon={<ClockIcon />} value={`${counts.trial}`} label={t("adminSubs.statTrial")} />
        <StatCard tone="info" icon={<ShieldCheckIcon />} value={`${counts.active}`} label={t("adminSubs.statActive")} />
        <StatCard tone="danger" icon={<AlertIcon />} value={`${counts.expired}`} label={t("adminSubs.statExpired")} />
        <StatCard tone="purple" icon={<UsersIcon />} value={`${counts.cancelled}`} label={t("adminSubs.statCancelled")} />
      </div>

      <div className={styles.headerRow}>
        <button type="button" className="btn btn-primary" onClick={() => setAssignOpen(true)}>
          {t("adminSubs.assignPlanButton")}
        </button>
      </div>

      {items.length === 0 ? (
        <p className={dashStyles.emptyState}>{t("adminSubs.empty")}</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{tUpper("adminSubs.colCompany")}</th>
              <th>{tUpper("adminSubs.colVertical")}</th>
              <th>{tUpper("adminSubs.colPlan")}</th>
              <th>{tUpper("adminSubs.colStatus")}</th>
              <th>{tUpper("adminSubs.colExpires")}</th>
              <th>{tUpper("adminSubs.colMessages")}</th>
              <th>{tUpper("adminSubs.colUsers")}</th>
              <th>{tUpper("adminSubs.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const pct = item.messages_limit > 0 ? Math.min(100, (item.messages_used / item.messages_limit) * 100) : 0;
              return (
                <tr key={item.company_id}>
                  <td>{item.company_name}</td>
                  <td>{item.vertical_slug ? t(`vertical.${item.vertical_slug}` as TranslationKey) : "—"}</td>
                  <td>{item.plan_name}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE_CLASS[item.status]}`}>
                      {t(`adminSubs.status.${item.status}` as TranslationKey)}
                    </span>
                  </td>
                  <td className="text-muted">
                    {item.status === "trial"
                      ? item.trial_ends_at
                        ? new Date(item.trial_ends_at).toLocaleDateString(locale)
                        : "—"
                      : item.current_period_end
                        ? new Date(item.current_period_end).toLocaleDateString(locale)
                        : "—"}
                  </td>
                  <td>
                    {item.is_beta ? (
                      <span className="text-muted">{t("adminSubs.unlimitedBeta")}</span>
                    ) : (
                      <div className={styles.progressBar}>
                        <div className={styles.progressTrack}>
                          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
                        </div>
                        <span className={styles.progressLabel}>
                          {item.messages_used}/{item.messages_limit}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {item.users_count}/{item.user_limit}
                  </td>
                  <td className={styles.rowMenuWrap}>
                    <button
                      type="button"
                      className={styles.rowMenuButton}
                      aria-label={t("adminSubs.menuActionsFor", { company: item.company_name })}
                      aria-haspopup="menu"
                      aria-expanded={openMenuId === item.company_id}
                      onClick={() => setOpenMenuId(openMenuId === item.company_id ? null : item.company_id)}
                    >
                      ⋯
                    </button>
                    {openMenuId === item.company_id && (
                      <div className={styles.rowMenu} role="menu">
                        <button
                          className={styles.rowMenuItem}
                          onClick={() => {
                            setChangePlanTarget(item);
                            setOpenMenuId(null);
                          }}
                        >
                          {t("adminSubs.menuChangePlan")}
                        </button>
                        <button className={styles.rowMenuItem} onClick={() => extendTrial(item)}>
                          {t("adminSubs.menuExtendTrial")}
                        </button>
                        {item.status !== "cancelled" && (
                          <button className={styles.rowMenuItem} onClick={() => cancelSub(item)}>
                            {t("adminSubs.menuCancel")}
                          </button>
                        )}
                        {(item.status === "cancelled" || item.status === "expired" || item.status === "suspended") && (
                          <button className={styles.rowMenuItem} onClick={() => reactivateSub(item)}>
                            {t("adminSubs.menuReactivate")}
                          </button>
                        )}
                        <button
                          className={styles.rowMenuItem}
                          onClick={() => {
                            setNotesTarget(item);
                            setOpenMenuId(null);
                          }}
                        >
                          {t("adminSubs.menuAddNote")}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {changePlanTarget && (
        <ChangePlanModal
          item={changePlanTarget}
          plans={plans}
          token={token}
          onClose={() => setChangePlanTarget(null)}
          onSaved={() => {
            setChangePlanTarget(null);
            refresh();
          }}
        />
      )}
      {notesTarget && (
        <NotesModal
          item={notesTarget}
          token={token}
          onClose={() => setNotesTarget(null)}
          onSaved={() => {
            setNotesTarget(null);
            refresh();
          }}
        />
      )}
      {assignOpen && (
        <AssignPlanModal
          plans={plans}
          token={token}
          onClose={() => setAssignOpen(false)}
          onSaved={() => {
            setAssignOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ChangePlanModal({
  item,
  plans,
  token,
  onClose,
  onSaved,
}: {
  item: SubscriptionEntry;
  plans: PlanSummary[];
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [planId, setPlanId] = useState(item.plan_id);
  const [billingCycle, setBillingCycle] = useState(item.billing_cycle);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.post(`/admin/subscriptions/${item.company_id}`, { plan_id: planId, billing_cycle: billingCycle }, token);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <h2>{t("adminSubs.changePlanTitle", { company: item.company_name })}</h2>
        <label className={styles.modalField}>
          {t("adminSubs.planLabel")}
          <select className="input" value={planId} onChange={(e) => setPlanId(Number(e.target.value))}>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.vertical_slug})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.billingCycleLabel")}
          <select className="input" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="monthly">{t("adminSubs.monthly")}</option>
            <option value="annual">{t("adminSubs.annual")}</option>
          </select>
        </label>
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {t("account.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotesModal({
  item,
  token,
  onClose,
  onSaved,
}: {
  item: SubscriptionEntry;
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/admin/subscriptions/${item.company_id}/notes`, { notes }, token);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <h2>{t("adminSubs.notesTitle", { company: item.company_name })}</h2>
        <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {t("account.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssignPlanModal({
  plans,
  token,
  onClose,
  onSaved,
}: {
  plans: PlanSummary[];
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [planId, setPlanId] = useState<number | "">("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [trialDays, setTrialDays] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get<CompanySummary[]>("/admin/companies", token).then(setCompanies);
  }, [token]);

  const filtered = useMemo(
    () => (query ? companies.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : []),
    [companies, query]
  );

  async function save() {
    if (!selectedCompanyId || !planId) return;
    setSaving(true);
    try {
      await api.post(
        `/admin/subscriptions/${selectedCompanyId}`,
        { plan_id: planId, billing_cycle: billingCycle, trial_days: trialDays ? Number(trialDays) : undefined },
        token
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <h2>{t("adminSubs.assignPlanTitle")}</h2>
        <label className={styles.modalField}>
          {t("adminSubs.companyLabel")}
          <input
            className="input"
            placeholder={t("adminSubs.companySearchPlaceholder")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedCompanyId(null);
            }}
          />
        </label>
        {filtered.length > 0 && !selectedCompanyId && (
          <div className={styles.companyResults}>
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                className={styles.companyResultItem}
                onClick={() => {
                  setSelectedCompanyId(c.id);
                  setQuery(c.name);
                }}
              >
                {c.name} <span className="text-muted">({c.vertical_slug})</span>
              </button>
            ))}
          </div>
        )}
        <label className={styles.modalField}>
          {t("adminSubs.planLabel")}
          <select className="input" value={planId} onChange={(e) => setPlanId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">—</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.vertical_slug})
              </option>
            ))}
          </select>
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.billingCycleLabel")}
          <select className="input" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="monthly">{t("adminSubs.monthly")}</option>
            <option value="annual">{t("adminSubs.annual")}</option>
          </select>
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.trialDaysLabel")}
          <input
            className="input"
            type="number"
            min="0"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            placeholder={t("adminSubs.trialDaysPlaceholder")}
          />
        </label>
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving || !selectedCompanyId || !planId} onClick={save}>
            {t("account.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlansTab() {
  const { user } = useAuth();
  const { t, tUpper } = useLocale();
  const token = user?.token ?? null;
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  async function refresh() {
    if (!token) return;
    setLoading(true);
    try {
      setPlans(await api.get<PlanSummary[]>("/admin/plans", token));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function toggleActive(plan: PlanSummary) {
    await api.patch(`/admin/plans/${plan.id}`, { is_active: !plan.is_active }, token);
    refresh();
  }

  if (loading) return <p className="text-muted">{t("common.loading")}</p>;

  return (
    <div>
      <div className={styles.headerRow}>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          {t("adminSubs.newPlanButton")}
        </button>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{tUpper("adminSubs.planColName")}</th>
            <th>{tUpper("adminSubs.planColVertical")}</th>
            <th>{tUpper("adminSubs.planColPrice")}</th>
            <th>{tUpper("adminSubs.planColBillingCycle")}</th>
            <th>{tUpper("adminSubs.planColUsers")}</th>
            <th>{tUpper("adminSubs.planColMessages")}</th>
            <th>{tUpper("adminSubs.planColSubscribers")}</th>
            <th>{tUpper("adminSubs.planColActive")}</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id}>
              <td>
                {p.name}
                {p.is_beta && <span className={styles.betaTag}>{tUpper("adminSubs.betaTag")}</span>}
              </td>
              <td>{p.vertical_slug ? t(`vertical.${p.vertical_slug}` as TranslationKey) : "—"}</td>
              <td>€{p.price_eur.toFixed(2)}</td>
              <td>{t(`adminSubs.${p.billing_cycle}` as TranslationKey)}</td>
              <td>{p.user_limit}</td>
              <td>{p.message_pool.toLocaleString()}</td>
              <td>{p.subscriber_count}</td>
              <td>
                <input type="checkbox" checked={p.is_active} onChange={() => toggleActive(p)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {createOpen && (
        <CreatePlanModal
          token={token}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function CreatePlanModal({
  token,
  onClose,
  onSaved,
}: {
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [verticalId, setVerticalId] = useState<number | "">("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [priceEur, setPriceEur] = useState("");
  const [userLimit, setUserLimit] = useState("");
  const [messagePool, setMessagePool] = useState("");
  const [isBeta, setIsBeta] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get<VerticalSummary[]>("/admin/verticals", token).then(setVerticals);
  }, [token]);

  async function save() {
    if (!name.trim() || !slug.trim() || !priceEur || !userLimit || !messagePool) return;
    setSaving(true);
    try {
      await api.post(
        "/admin/plans",
        {
          vertical_id: verticalId === "" ? null : verticalId,
          name,
          slug,
          billing_cycle: billingCycle,
          price_eur: Number(priceEur),
          user_limit: Number(userLimit),
          message_pool: Number(messagePool),
          is_beta: isBeta,
          is_active: true,
        },
        token
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={`card ${styles.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <h2>{t("adminSubs.newPlanButton")}</h2>
        <label className={styles.modalField}>
          {t("adminSubs.planColName")}
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.planSlugLabel")}
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.planColVertical")}
          <select
            className="input"
            value={verticalId}
            onChange={(e) => setVerticalId(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">—</option>
            {verticals.map((v) => (
              <option key={v.id} value={v.id}>
                {v.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.billingCycleLabel")}
          <select className="input" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
            <option value="monthly">{t("adminSubs.monthly")}</option>
            <option value="annual">{t("adminSubs.annual")}</option>
          </select>
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.planColPrice")}
          <input className="input" type="number" min="0" step="0.01" value={priceEur} onChange={(e) => setPriceEur(e.target.value)} />
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.planColUsers")}
          <input className="input" type="number" min="1" value={userLimit} onChange={(e) => setUserLimit(e.target.value)} />
        </label>
        <label className={styles.modalField}>
          {t("adminSubs.planColMessages")}
          <input className="input" type="number" min="0" value={messagePool} onChange={(e) => setMessagePool(e.target.value)} />
        </label>
        <label className={styles.modalCheckboxField}>
          <input type="checkbox" checked={isBeta} onChange={(e) => setIsBeta(e.target.checked)} />
          {t("adminSubs.betaTag")}
        </label>
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
            {t("account.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
