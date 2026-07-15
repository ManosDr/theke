"use client";

import { useEffect } from "react";

// A next/dynamic chunk request can 404 if it races an in-flight rebuild (dev
// recompile) or targets a hash a prod deploy has since rotated out - neither
// is preventable from here, so instead of leaving the user on a dead error
// screen, reload once automatically. The sessionStorage flag stops this from
// looping forever if the reload doesn't actually fix it (e.g. a genuinely
// broken deploy) - one retry, then let the error surface normally.
const RELOAD_FLAG = "theke-chunk-error-reload";

function isChunkLoadError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /Loading chunk [\w-]+ failed|ChunkLoadError/i.test(message);
}

function recoverOnce() {
  if (sessionStorage.getItem(RELOAD_FLAG)) return;
  sessionStorage.setItem(RELOAD_FLAG, "1");
  window.location.reload();
}

export function ChunkErrorRecovery() {
  useEffect(() => {
    // A successful render means the current bundle is fine - clear the flag
    // so a *future* chunk error gets its own single retry rather than being
    // silently ignored because of one from earlier in the session.
    sessionStorage.removeItem(RELOAD_FLAG);

    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.message) || isChunkLoadError(event.error?.name)) {
        recoverOnce();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = typeof reason === "string" ? reason : reason?.message ?? reason?.name;
      if (isChunkLoadError(message)) {
        recoverOnce();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
