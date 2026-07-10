"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./Tooltip.module.css";

interface TooltipProps {
  text: string;
  children: ReactNode;
}

// Hover on desktop, tap-to-toggle on mobile (no hover state there) - both
// handled by the same open/close state, closed on outside click/tap.
export default function Tooltip({ text, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <span className={styles.wrap} ref={wrapperRef} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((v) => !v)} aria-label={text}>
        {children}
      </button>
      {open && (
        <span className={styles.bubble} role="tooltip">
          {text}
          <span className={styles.arrow} />
        </span>
      )}
    </span>
  );
}
