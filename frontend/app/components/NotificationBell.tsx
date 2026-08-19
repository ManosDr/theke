"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { parseApiDate } from "../lib/datetime";
import { useLocale } from "../lib/i18n";
import type { NotificationListResponse, NotificationSummary } from "../lib/types";
import { BellIcon } from "./NavIcons";
import styles from "./NotificationBell.module.css";

const POLL_INTERVAL_MS = 60_000;

function timeAgo(iso: string, locale: string): string {
  const diffMin = Math.round((Date.now() - parseApiDate(iso).getTime()) / 60000);
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
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

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

  // .panel is `position: absolute; right: 0` by default (CSS), anchoring
  // its right edge to .wrapper's right edge - correct as long as the
  // wrapper sits flush against the viewport's right edge. On narrow
  // viewports the bell isn't the last topbar control (the account menu
  // sits to its right), so the wrapper can be well short of the right
  // edge, and a 320px panel right-anchored to it runs off the LEFT edge
  // of the screen instead. Same measure-and-clamp principle as Tooltip's
  // flip logic: on open, read the trigger's real viewport position and
  // override left/right with an explicit, clamped value so the panel
  // always stays fully on-screen. Recomputed on resize (not just open)
  // since, unlike Tooltip's portaled bubble, .panel is a normal
  // position:absolute child that already scrolls correctly with the page -
  // only its horizontal placement needs correcting.
  useEffect(() => {
    if (!open) return;
    function reposition() {
      const wrapper = menuRef.current;
      if (!wrapper) return;
      const margin = 12; // matches var(--space-3)
      const wrapperRect = wrapper.getBoundingClientRect();
      const panelWidth = Math.min(320, window.innerWidth - margin * 2);
      const naturalLeft = wrapperRect.right - panelWidth;
      const clampedLeft = Math.max(margin, Math.min(naturalLeft, window.innerWidth - panelWidth - margin));
      setPanelStyle({ left: clampedLeft - wrapperRect.left, right: "auto", width: panelWidth });
    }
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
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
        <div className={styles.panel} role="menu" style={panelStyle}>
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
