"use client";

import { useEffect, useRef, useState } from "react";

import { useLocale } from "../lib/i18n";
import { useCustomerSearch } from "../lib/useCustomerSearch";
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
  // True while the search box has typed text that was never committed via
  // either selecting an existing result or clicking "Νέος πελάτης" - the
  // exact silent-loss window this flag exists to close. The parent's own
  // validate() blocks submission on this rather than the combobox silently
  // discarding the typed text, since only the user knows whether they meant
  // to search for an existing customer or create a new one.
  hasUnresolvedQuery: boolean;
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
const PHONE_MAX_LENGTH = 20; // matches customers.phone varchar(20) column

export default function CustomerCombobox({ token, onChange, validateSignal }: CustomerComboboxProps) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const results = useCustomerSearch(query, token, !selected && !creatingNew);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<NewCustomerDraft>({ name: "", afm: "", phone: "", email: "" });
  const [afmError, setAfmError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!validateSignal) return;
    if (creatingNew && !draft.name.trim()) setNameError(t("customer.errorName"));
    if (!selected && !creatingNew && query.trim()) setQueryError(t("customer.errorUnresolvedQuery"));
  }, [validateSignal]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setQueryError(null);
    onChange({ customerId: customer.id, newCustomer: null, hasUnresolvedQuery: false });
  }

  function startNewCustomer() {
    const prefilled = { name: query.trim(), afm: "", phone: "", email: "" };
    setDraft(prefilled);
    setCreatingNew(true);
    setOpen(false);
    setAfmError(null);
    setPhoneError(null);
    setQueryError(null);
    onChange({ customerId: null, newCustomer: prefilled, hasUnresolvedQuery: false });
  }

  function updateDraft(field: keyof NewCustomerDraft, value: string) {
    const next = { ...draft, [field]: value };
    setDraft(next);
    if (field === "afm") {
      setAfmError(value && !AFM_PATTERN.test(value) ? t("customer.afmInvalid") : null);
    }
    if (field === "phone") {
      setPhoneError(value.length > PHONE_MAX_LENGTH ? t("customer.phoneTooLong") : null);
    }
    if (field === "name" && value.trim()) {
      setNameError(null);
    }
    onChange({ customerId: null, newCustomer: next, hasUnresolvedQuery: false });
  }

  function clearSelection() {
    setSelected(null);
    setCreatingNew(false);
    setQuery("");
    setAfmError(null);
    setNameError(null);
    setPhoneError(null);
    setQueryError(null);
    onChange({ customerId: null, newCustomer: null, hasUnresolvedQuery: false });
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
              const value = e.target.value;
              setQuery(value);
              setOpen(true);
              if (queryError) setQueryError(null);
              onChange({ customerId: null, newCustomer: null, hasUnresolvedQuery: value.trim().length > 0 });
            }}
            onFocus={() => setOpen(true)}
            placeholder={t("customer.searchPlaceholder")}
            autoComplete="off"
            aria-invalid={!!queryError}
          />
          {queryError && <FieldError message={queryError} />}
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
              <input
                className="input"
                type="text"
                value={draft.phone}
                onChange={(e) => updateDraft("phone", e.target.value)}
                maxLength={PHONE_MAX_LENGTH}
                aria-invalid={!!phoneError}
              />
              {phoneError && <FieldError message={phoneError} />}
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
