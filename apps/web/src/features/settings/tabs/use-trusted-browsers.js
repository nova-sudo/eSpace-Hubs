"use client";

/**
 * Trusted browsers (skip the 2FA prompt for 30 days): how many this
 * user has, and "forget all". Data only — Account tab renders it.
 */

import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet } from "@/lib/api-client";

export function useTrustedBrowsers(enabled) {
  const [count, setCount] = useState(null);
  const [forgetting, setForgetting] = useState(false);

  const load = useCallback(async () => {
    const r = await apiGet("/auth/trusted-devices");
    if (r.ok) setCount(r.data?.count ?? 0);
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  const forgetAll = useCallback(async () => {
    setForgetting(true);
    const r = await apiDelete("/auth/trusted-devices");
    setForgetting(false);
    if (r.ok) setCount(0);
    return r;
  }, []);

  return { count, forgetting, forgetAll };
}
