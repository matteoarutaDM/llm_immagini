"use client";

import { useCallback, useState } from "react";

import { authApi } from "../../_lib/api";

/** Keys the backoffice may keep client-side (UI preferences only, never tokens). */
const LOCAL_KEY_PREFIX = "bo:";

function clearLocalState() {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    try {
      Object.keys(storage)
        .filter((key) => key.startsWith(LOCAL_KEY_PREFIX))
        .forEach((key) => storage.removeItem(key));
    } catch {
      // Storage can be unavailable (private mode, blocked site data).
    }
  }
}

/**
 * Invalidates the session server-side, wipes local UI state and performs a
 * full navigation so no in-memory data from the previous session survives.
 */
export function useLogout() {
  const [pending, setPending] = useState(false);
  const logout = useCallback(async () => {
    setPending(true);
    try {
      await authApi.logout();
    } catch {
      // Even if the call fails the cookie is cleared by the next login; carry on.
    }
    clearLocalState();
    window.location.replace("/admin/login?reason=logout");
  }, []);
  return { logout, pending };
}
