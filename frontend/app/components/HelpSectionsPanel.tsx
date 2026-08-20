"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { HelpRole, HelpSectionAdminDetail, HelpSectionAdminSummary, HelpVertical } from "../lib/types";
import styles from "./HelpSectionsPanel.module.css";

const ALL_ROLES: HelpRole[] = ["member", "admin", "super_admin"];
const ROLE_LABEL_KEY: Record<HelpRole, "adminHelpSections.roleMember" | "adminHelpSections.roleAdmin" | "adminHelpSections.roleSuperAdmin"> = {
  member: "adminHelpSections.roleMember",
  admin: "adminHelpSections.roleAdmin",
  super_admin: "adminHelpSections.roleSuperAdmin",
};

const EMPTY_FORM = {
  slug: "",
  titleEl: "",
  titleEn: "",
  bodyEl: "",
  bodyEn: "",
  roles: new Set<HelpRole>(),
  vertical: "" as HelpVertical | "",
  isActive: true,
};

export function HelpSectionsPanel() {
  const { user } = useAuth();
  const { t } = useLocale();
  const token = user?.token ?? null;

  const [sections, setSections] = useState<HelpSectionAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  async function refreshList() {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.get<HelpSectionAdminSummary[]>("/admin/help-sections", token);
      setSections(data.sort((a, b) => a.display_order - b.display_order));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function resetMessages() {
    setError(null);
    setSavedMessage(null);
  }

  async function openSection(id: number) {
    if (!token) return;
    resetMessages();
    const data = await api.get<HelpSectionAdminDetail>(`/admin/help-sections/${id}`, token);
    setSelectedId(id);
    setForm({
      slug: data.slug,
      titleEl: data.title_el,
      titleEn: data.title_en,
      bodyEl: data.body_el,
      bodyEn: data.body_en,
      roles: new Set(data.visible_to_roles),
      vertical: data.vertical_scope ?? "",
      isActive: data.is_active,
    });
  }

  function openNew() {
    resetMessages();
    setSelectedId("new");
    setForm(EMPTY_FORM);
  }

  function close() {
    setSelectedId(null);
    resetMessages();
  }

  function toggleRole(role: HelpRole) {
    setForm((f) => {
      const roles = new Set(f.roles);
      if (roles.has(role)) roles.delete(role);
      else roles.add(role);
      return { ...f, roles };
    });
  }

  async function save() {
    if (!token || selectedId === null) return;
    setBusy(true);
    resetMessages();
    const payload = {
      slug: form.slug,
      title_el: form.titleEl,
      title_en: form.titleEn,
      body_el: form.bodyEl,
      body_en: form.bodyEn,
      visible_to_roles: Array.from(form.roles),
      vertical_scope: form.vertical || null,
      is_active: form.isActive,
    };
    try {
      if (selectedId === "new") {
        await api.post<HelpSectionAdminDetail>("/admin/help-sections", payload, token);
      } else {
        await api.patch<HelpSectionAdminDetail>(`/admin/help-sections/${selectedId}`, payload, token);
      }
      setSavedMessage(t("adminHelpSections.saved"));
      await refreshList();
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: number) {
    if (!token) return;
    await api.del(`/admin/help-sections/${id}`, token);
    await refreshList();
  }

  async function move(index: number, direction: -1 | 1) {
    if (!token) return;
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const reordered = [...sections];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setSections(reordered);
    await api.patch("/admin/help-sections/reorder", { ordered_ids: reordered.map((s) => s.id) }, token);
    await refreshList();
  }

  return (
    <div>
      <div className={styles.editorHeader}>
        <div>
          <h1>{t("adminHelpSections.title")}</h1>
          <p className="text-muted">{t("adminHelpSections.subtitle")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openNew}>
          {t("adminHelpSections.addNew")}
        </button>
      </div>

      {!loading && sections.length > 0 && (
        <input
          className="input"
          type="text"
          placeholder={t("adminHelpSections.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: "var(--space-3)", maxWidth: 320 }}
        />
      )}

      {loading ? (
        <p className="text-muted">{t("common.loading")}</p>
      ) : (
        <div className={styles.list}>
          {sections
            .filter((section) => !search || section.title_el.toLowerCase().includes(search.toLowerCase()))
            .map((section) => {
              const i = sections.indexOf(section);
              return (
            <div key={section.id} className={`${styles.row} ${!section.is_active ? styles.rowInactive : ""}`}>
              <div className={styles.reorderCol}>
                <button
                  type="button"
                  className={styles.reorderBtn}
                  disabled={!!search || i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t("adminHelpSections.moveUp")}
                  title={search ? t("adminHelpSections.reorderDisabledWhileSearching") : undefined}
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.reorderBtn}
                  disabled={!!search || i === sections.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("adminHelpSections.moveDown")}
                  title={search ? t("adminHelpSections.reorderDisabledWhileSearching") : undefined}
                >
                  ▼
                </button>
              </div>
              <button type="button" className={styles.rowMain} onClick={() => openSection(section.id)}>
                <span className={styles.rowTitle}>{section.title_el}</span>
                <span className={styles.badgeRow}>
                  {section.visible_to_roles.map((r) => (
                    <span key={r} className={styles.badge}>
                      {t(ROLE_LABEL_KEY[r])}
                    </span>
                  ))}
                  <span className={styles.badge}>
                    {section.vertical_scope
                      ? section.vertical_scope === "construction"
                        ? t("adminHelpSections.verticalConstruction")
                        : t("adminHelpSections.verticalTax")
                      : t("adminHelpSections.verticalAll")}
                  </span>
                  <span className={section.is_active ? `${styles.badge} ${styles.badgeActive}` : `${styles.badge} ${styles.badgeInactive}`}>
                    {section.is_active ? t("adminHelpSections.active") : t("adminHelpSections.inactive")}
                  </span>
                </span>
              </button>
              {section.is_active && (
                <button type="button" className="btn btn-secondary" onClick={() => deactivate(section.id)}>
                  {t("adminHelpSections.deactivate")}
                </button>
              )}
            </div>
              );
            })}
          {search && sections.every((s) => !s.title_el.toLowerCase().includes(search.toLowerCase())) && (
            <p className="text-muted">{t("chat.context.noResults")}</p>
          )}
        </div>
      )}

      {savedMessage && !selectedId && <div className={styles.savedMessage}>{savedMessage}</div>}

      {selectedId !== null && (
        <div className={styles.modalScrim} onClick={close}>
          <div className={styles.modal} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{selectedId === "new" ? t("adminHelpSections.addNew") : form.titleEl}</h2>
              <button type="button" className="btn btn-secondary" onClick={close}>
                {t("common.close")}
              </button>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.label}>{t("adminHelpSections.slugLabel")}</label>
              <input className="input" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} />

              <label className={styles.label}>{t("adminHelpSections.titleElLabel")}</label>
              <input className="input" value={form.titleEl} onChange={(e) => setForm((f) => ({ ...f, titleEl: e.target.value }))} />

              <label className={styles.label}>{t("adminHelpSections.titleEnLabel")}</label>
              <input className="input" value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} />

              <label className={styles.label}>{t("adminHelpSections.bodyElLabel")}</label>
              <textarea
                className={`input ${styles.contentArea}`}
                value={form.bodyEl}
                onChange={(e) => setForm((f) => ({ ...f, bodyEl: e.target.value }))}
                rows={10}
              />

              <label className={styles.label}>{t("adminHelpSections.bodyEnLabel")}</label>
              <textarea
                className={`input ${styles.contentArea}`}
                value={form.bodyEn}
                onChange={(e) => setForm((f) => ({ ...f, bodyEn: e.target.value }))}
                rows={10}
              />

              <div className={styles.fieldRow}>
                <div>
                  <label className={styles.label}>{t("adminHelpSections.rolesLabel")}</label>
                  <div className={styles.checkboxGroup}>
                    {ALL_ROLES.map((role) => (
                      <label key={role} className={styles.checkboxLabel}>
                        <input type="checkbox" checked={form.roles.has(role)} onChange={() => toggleRole(role)} />
                        {t(ROLE_LABEL_KEY[role])}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={styles.label}>{t("adminHelpSections.verticalLabel")}</label>
                  <select
                    className="input"
                    value={form.vertical}
                    onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value as HelpVertical | "" }))}
                  >
                    <option value="">{t("adminHelpSections.verticalAll")}</option>
                    <option value="construction">{t("adminHelpSections.verticalConstruction")}</option>
                    <option value="tax_accounting">{t("adminHelpSections.verticalTax")}</option>
                  </select>
                </div>

                <div>
                  <label className={styles.label}>{t("adminHelpSections.activeLabel")}</label>
                  <label className={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    />
                    {t("adminHelpSections.activeLabel")}
                  </label>
                </div>
              </div>

              {error && <div className={styles.blockError}>{error}</div>}
            </div>

            <div className={styles.modalActions}>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {t("adminHelpSections.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
