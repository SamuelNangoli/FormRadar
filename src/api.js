import { useEffect, useState } from "react";

const cache = new Map();

export function useResource(
  url,
  { enabled = true, refresh = 0, ttl = 60_000 } = {},
) {
  const [state, setState] = useState({
    key: null,
    data: null,
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled || !url) return;
    let active = true;
    const controller = new AbortController();
    let previous = cache.get(url);
    // Match the server's stale-data ceiling even if this tab stays open for days.
    const fetchedAt = Date.parse(previous?.data?.meta?.fetchedAt);
    const cachedAt = previous && Math.min(
      previous.at, Number.isFinite(fetchedAt) ? fetchedAt : previous.at,
    );
    if (previous && Date.now() - cachedAt > 86_400_000) {
      cache.delete(url);
      previous = undefined;
    }
    if (!refresh && previous && Date.now() - previous.at < ttl) {
      setState({ key: url, data: previous.data, loading: false, error: null });
      return;
    }
    setState({
      key: url,
      data: previous?.data || null,
      loading: true,
      error: null,
    });
    const timer = setTimeout(() => controller.abort(), 20_000);
    (async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (
          !response.headers.get("content-type")?.includes("application/json")
        ) {
          throw new Error(
            "The FormRadar API is unavailable. Stop the old Vite server and restart with npm run dev in the FormRadar project folder.",
          );
        }
        const body = await response.json();
        if (!response.ok) {
          const failure = new Error(
            body.error?.message ||
              "Could not load football data. Please retry.",
          );
          failure.code = body.error?.code;
          failure.retryAfter = body.error?.retryAfter;
          throw failure;
        }
        if (!active) return;
        if (cache.size >= 100 && !cache.has(url))
          cache.delete(cache.keys().next().value);
        cache.set(url, { data: body, at: Date.now() });
        setState({ key: url, data: body, loading: false, error: null });
      } catch (error) {
        if (active)
          setState({
            key: url,
            data: previous?.data || null,
            loading: false,
            error: controller.signal.aborted
              ? new Error("The request timed out. Please retry.")
              : error instanceof TypeError
                ? new Error(
                    "Could not connect to FormRadar. Check that its server is running and retry.",
                  )
                : error,
          });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, enabled, refresh, ttl]);
  if (!enabled || !url) return { data: null, loading: false, error: null };
  // Never show a previous league or team's response while a new URL is loading.
  return state.key === url ? state : { data: null, loading: true, error: null };
}
