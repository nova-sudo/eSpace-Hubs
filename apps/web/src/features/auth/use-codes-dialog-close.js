"use client";

/**
 * Close handling shared by the two dialogs that show freshly minted backup
 * codes (move-to-a-new-phone, regenerate). By the time the codes are on
 * screen the server has already revoked the old ones, so a stray Escape or
 * backdrop click must not throw them away.
 *
 *   - While a request is in flight, Escape / backdrop / X do nothing — the
 *     result (a new secret, new codes) must land in an open dialog.
 *   - While codes are shown and have not been copied or downloaded, closing
 *     asks first. The explicit "I've saved these" button closes directly.
 *   - `requestGen` changes on every open and close; a handler compares the
 *     value it captured before `await` so a late response never repopulates
 *     a closed (or re-opened) dialog.
 */

import { useCallback, useEffect, useRef } from "react";

export const UNSAVED_CODES_PROMPT =
  "You haven't copied or downloaded these backup codes, and they won't be shown again. Close anyway?";

export function useCodesDialogClose({ open, onClose, submitting, codesShown, codesSaved }) {
  const genRef = useRef(0);
  useEffect(() => {
    genRef.current += 1;
  }, [open]);

  const requestClose = useCallback(() => {
    if (submitting) return;
    if (
      codesShown &&
      !codesSaved &&
      typeof window !== "undefined" &&
      !window.confirm(UNSAVED_CODES_PROMPT)
    ) {
      return;
    }
    onClose?.();
  }, [submitting, codesShown, codesSaved, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  /** Snapshot before an await; `isCurrent(snap)` after it. */
  const snapshot = useCallback(() => genRef.current, []);
  const isCurrent = useCallback((snap) => snap === genRef.current, []);

  return { requestClose, snapshot, isCurrent };
}
