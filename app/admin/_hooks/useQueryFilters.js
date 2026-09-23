"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Keeps list filters in the URL (shareable links, back button, reload-safe).
 * Changing any filter other than `page` resets pagination to page 1.
 *
 * @param {Record<string, string>} defaults
 */
export function useQueryFilters(defaults) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(() => {
    const values = { ...defaults };
    for (const key of Object.keys(defaults)) values[key] = searchParams.get(key) ?? defaults[key];
    return values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === "" || value === null || value === undefined || value === defaults[key]) next.delete(key);
        else next.set(key, String(value));
      }
      if (!("page" in patch)) next.delete("page");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, pathname, searchParams],
  );

  return { filters, setFilters, key: searchParams.toString() };
}
