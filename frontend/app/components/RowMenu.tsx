"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./RowMenu.module.css";

// Fixes a real, systemic clipping bug: every admin table lives inside a
// `.card` (globals.css), which sets overflow-x:auto - and per the CSS spec,
// setting only one axis to a non-visible value forces the OTHER axis to
// `auto` too, so the card clips vertically as well. A row-menu dropdown
// positioned with `position: absolute` relative to its own row (the
// previous pattern, duplicated across 7 admin panels) gets silently cut off
// whenever that row is near the bottom of a tall/scrolled table - exactly
// what surfaced blocking Part E's own gap-resolution action. Portaling the
// menu to document.body with `position: fixed`, positioned from the
// trigger button's own getBoundingClientRect(), escapes the clipping
// ancestor entirely regardless of which card/table it's opened from.
export function RowMenu({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    function updatePosition() {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({ top: rect.bottom + 4, right: Math.max(4, window.innerWidth - rect.right) });
    }
    updatePosition();
    // Menu tracks the trigger button's real screen position - a portal
    // escapes the clipping ancestor but not its own scroll/resize, so this
    // has to actively re-measure rather than position once and forget.
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onToggle();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onToggle();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={styles.wrap}>
      <button
        ref={btnRef}
        type="button"
        className={styles.button}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        ⋯
      </button>
      {open &&
        position &&
        createPortal(
          <div ref={menuRef} className={styles.menu} style={{ top: position.top, right: position.right }} role="menu">
            {children}
          </div>,
          document.body
        )}
    </div>
  );
}
