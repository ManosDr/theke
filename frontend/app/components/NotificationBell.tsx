"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useLocale } from "../lib/i18n";
import type { NotificationListResponse, NotificationSummary } from "../lib/types";
import { BellIcon } from "./NavIcons";
import styles from "./NotificationBell.module.css";

const POLL_INTERVAL_MS = 60_000;

function timeAgo(iso: string, locale: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const isGreek = locale.startsWith("el");
  if (diffMin < 1) return isGreek ? "τώρα" : "just now";
  if (diffMin < 60) return `${diffMin}${isGreek ? "λ" : "m"}`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}${isGreek ? "ω" : "h"}`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}${isGreek ? "η" : "d"}`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { t, locale } = useLocale();
  const router = useRouter();
  const token = user?.token ?? null;

  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    async function refresh() {
      try {
        const data = await api.get<NotificationListResponse>("/notifications", token);
        if (!cancelled) {
          setItems(data.items);
          setUnreadCount(data.unread_count);
        }
      } catch {
        // notifications are best-effort - don't surface fetch errors in the UI
      }
    }

    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function markAllRead() {
    if (!token) return;
    await api.post("/notifications/read-all", undefined, token);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }

  async function openNotification(n: NotificationSummary) {
    if (!n.is_read && token) {
      api.post(`/notifications/${n.id}/read`, undefined, token).catch(() => {});
      setItems((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: true } : item)));
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  if (!user) return null;

  return (
    <div className={styles.wrapper} ref={menuRef}>
      <button
        className={styles.trigger}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("notifications.title")}
      >
        <BellIcon />
        {unreadCount > 0 && <span className={styles.dot} aria-hidden="true" />}
      </button>

      {open && (
        <div className={styles.panel} role="menu">
          <div className={styles.panelHeader}>
            <span>{t("notifications.title")}</span>
            {unreadCount > 0 && (
              <button className={styles.markAllRead} onClick={markAllRead}>
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>{t("notifications.empty")}</p>
          ) : (
            <ul className={styles.list}>
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className={`${styles.item} ${!n.is_read ? styles.itemUnread : ""}`}
                    onClick={() => openNotification(n)}
                  >
                    <span className={styles.itemTitle}>{n.title}</span>
                    {n.body && <span className={styles.itemBody}>{n.body}</span>}
                    <span className={styles.itemTime}>{timeAgo(n.created_at, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
