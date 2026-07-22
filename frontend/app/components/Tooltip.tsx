"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Tooltip.module.css";

interface TooltipProps {
  text: string;
  children: ReactNode;
}

interface Coords {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

// Hover on desktop, tap-to-toggle on mobile (no hover state there) - both
// handled by the same open/close state, closed on outside click/tap.
//
// The bubble is rendered via a portal into document.body with
// position:fixed coordinates computed from the trigger's own
// getBoundingClientRect() - not position:absolute inside this component's
// own DOM position. Most tooltip triggers here sit inside a truncating
// label (overflow:hidden + text-overflow:ellipsis, e.g. AttentionCard's
// .label), and an absolutely-positioned descendant is still clipped by
// that ancestor's overflow:hidden even though it visually sits outside the
// label's box - the bubble rendered but stayed fully invisible. A portal
// escapes that entirely, wherever this component is used.
export default function Tooltip({ text, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (triggerRef.current && !triggerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleReposition() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    // Scroll/resize can move the trigger out from under a fixed-position
    // bubble computed at open-time - simplest correct behavior is to close
    // it rather than track and re-measure on every scroll frame.
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [open]);

  function openTooltip() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Flips below the trigger when there isn't enough room above the
    // viewport top for the bubble (a column-header tooltip near the very
    // top of the page, for instance) - otherwise defaults above, matching
    // the original design.
    const placement: Coords["placement"] = rect.top < 90 ? "bottom" : "top";
    setCoords({
      top: placement === "top" ? rect.top : rect.bottom,
      left: rect.left + rect.width / 2,
      placement,
    });
    setOpen(true);
  }

  return (
    <span className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onMouseEnter={openTooltip}
        onMouseLeave={() => setOpen(false)}
        onClick={() => (open ? setOpen(false) : openTooltip())}
        aria-label={text}
      >
        {children}
      </button>
      {open &&
        coords &&
        createPortal(
          <span
            className={`${styles.bubble} ${coords.placement === "bottom" ? styles.bubbleBelow : ""}`}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
          >
            {text}
            <span className={styles.arrow} />
          </span>,
          document.body
        )}
    </span>
  );
}
