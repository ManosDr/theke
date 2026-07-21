"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useLocale } from "../lib/i18n";
import { MailIcon } from "./StatIcons";
import { CloseIcon, PhoneIcon, PlusIcon } from "./UiIcons";
import type { CustomerSummary } from "../lib/types";
import styles from "./CustomerCombobox.module.css";
import FieldError from "./FieldError";

export interface NewCustomerDraft {
  name: string;
  afm: string;
  phone: string;
  email: string;
}

export interface CustomerComboboxState {
  customerId: number | null;
  // Non-null only while the user is filling in the inline "new customer"
  // form - the parent creates the real customer (POST /customers) at save
  // time, atomically with the project, rather than this component creating
  // it eagerly on every keystroke.
  newCustomer: NewCustomerDraft | null;
}

interface CustomerComboboxProps {
  token: string | null;
  onChange: (state: CustomerComboboxState) => void;
  // Bumped by the parent form on a failed submit attempt, so this component
  // can surface its own field errors (new-customer name/AFM) at the same
  // moment - without the parent needing to reach into this component's
  // internal draft state.
  validateSignal?: number;
}

const AFM_PATTERN = /^\d{9}$/;

export default function CustomerCombobox({ token, onChange, validateSignal }: CustomerComboboxProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [draft, setDraft] = useState<NewCustomerDraft>({ name: "", afm: "", phone: "", email: "" });
  const [afmError, setAfmError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!validateSignal) return;
    if (creatingNew && !draft.name.trim()) setNameError(t("customer.errorName"));
  }, [validateSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token || selected || creatingNew || query.trim().length < 1) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get<CustomerSummary[]>(`/customers?q=${encodeURIComponent(query.trim())}`, token)
        .then((data) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, token, selected, creatingNew]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectExisting(customer: CustomerSummary) {
    setSelected(customer);
    setCreatingNew(false);
    setOpen(false);
    setQuery(customer.name);
    onChange({ customerId: customer.id, newCustomer: null });
  }

  function startNewCustomer() {
    const prefilled = { name: query.trim(), afm: "", phone: "", email: "" };
    setDraft(prefilled);
    setCreatingNew(true);
    setOpen(false);
    setAfmError(null);
    onChange({ customerId: null, newCustomer: prefilled });
  }

  function updateDraft(field: keyof NewCustomerDraft, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (field === "afm") {
      setAfmError(value && !AFM_PATTERN.test(value) ? t("customer.afmInvalid") : null);
    }
    if (field === "name" && value.trim()) {
      setNameError(null);
    }
    onChange({ customerId: null, newCustomer: next });
  }

  function clearSelection() {
    setSelected(null);
    setCreatingNew(false);
    setQuery("");
    setResults([]);
    setAfmError(null);
    setNameError(null);
    onChange({ customerId: null, newCustomer: null });
  }

  return (
    <div className={styles.container} ref={containerRef}>
      {!selected && !creatingNew && (
        <>
          <input
            className="input"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t("customer.searchPlaceholder")}
            autoComplete="off"
          />
          {open && (
            <div className={styles.dropdown}>
              {results.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className={styles.option}
                  onClick={() => selectExisting(c)}
                >
                  <span className={styles.optionName}>{c.name}</span>
                  <span className={styles.optionMeta}>
                    {c.afm && `${t("customer.afmShort")} ${c.afm}`}
                    {c.afm && " · "}
                    {t("customer.projectCount", { count: c.project_count })}
                  </span>
                </button>
              ))}
              {query.trim().length >= 1 && (
                <button type="button" className={`${styles.option} ${styles.newOption}`} onClick={startNewCustomer}>
                  <PlusIcon size={14} />
                  {t("customer.newCustomer")}: {query.trim()}
                </button>
              )}
            </div>
          )}
        </>
      )}

      {selected && (
        <div className={styles.selectedCard}>
          <div className={styles.selectedHeader}>
            <strong>{selected.name}</strong>
            <button type="button" className={styles.changeLink} onClick={clearSelection}>
              <CloseIcon size={12} />
              {t("customer.change")}
            </button>
          </div>
          <div className={styles.selectedMeta}>
            {selected.phone && (
              <span>
                <PhoneIcon size={13} />
                {selected.phone}
              </span>
            )}
            {selected.email && (
              <span>
                <MailIcon size={13} />
                {selected.email}
              </span>
            )}
            {!selected.phone && !selected.email && <span className="text-muted">{t("customer.noContactInfo")}</span>}
          </div>
        </div>
      )}

      {creatingNew && (
        <div className={styles.newForm}>
          <div className={styles.selectedHeader}>
            <strong>{t("customer.newCustomer")}</strong>
            <button type="button" className={styles.changeLink} onClick={clearSelection}>
              <CloseIcon size={12} />
              {t("customer.change")}
            </button>
          </div>
          <label className={styles.newField}>
            {t("customer.name")}
            <input
              className="input"
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft("name", e.target.value)}
              aria-invalid={!!nameError}
            />
            {nameError && <FieldError message={nameError} />}
          </label>
          <div className={styles.newFieldRow}>
            <label className={styles.newField}>
              {t("customer.afm")}
              <input
                className="input"
                type="text"
                value={draft.afm}
                onChange={(e) => updateDraft("afm", e.target.value)}
                maxLength={9}
                aria-invalid={!!afmError}
              />
              {afmError && <FieldError message={afmError} />}
            </label>
            <label className={styles.newField}>
              {t("customer.phone")}
              <input className="input" type="text" value={draft.phone} onChange={(e) => updateDraft("phone", e.target.value)} />
            </label>
          </div>
          <label className={styles.newField}>
            {t("customer.email")}
            <input className="input" type="email" value={draft.email} onChange={(e) => updateDraft("email", e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
