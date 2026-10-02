"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal data-fetching hook: loading / error / data / reload, with request
 * cancellation when inputs change and optional polling.
 *
 * `fetcher` receives an AbortSignal; `key` is a stable string that identifies
 * the request (e.g. the serialised filters) and triggers a refetch on change.
 *
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fetcher
 * @param {string} key
 * @param {{ pollMs?: number }} [options]
 */
export function useResource(fetcher, key, { pollMs } = {}) {
  const [state, setState] = useState(/** @type {{ data: T | null, error: Error | null, loading: boolean }} */ ({
    data: null,
    error: null,
    loading: true,
  }));
  const [version, setVersion] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const controller = new AbortController();
    let pollTimer;

    async function run(isBackground) {
      if (!isBackground) setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const data = await fetcherRef.current(controller.signal);
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      } catch (error) {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        // A failed background refresh keeps the last good data on screen.
        setState((current) => ({ ...current, error, loading: false }));
      }
      if (pollMs && !controller.signal.aborted) pollTimer = window.setTimeout(() => void run(true), pollMs);
    }

    void run(false);
    return () => {
      controller.abort();
      window.clearTimeout(pollTimer);
    };
  }, [key, version, pollMs]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);

  /** Replaces the cached data after a successful mutation, without refetching. */
  const mutate = useCallback((updater) => {
    setState((current) => ({ ...current, data: typeof updater === "function" ? updater(current.data) : updater }));
  }, []);

  return { ...state, reload, mutate };
}
