import "server-only";

/**
 * Process-wide singletons that survive dev hot reloads. Everything stored here
 * (sessions, OTP challenges, rate-limit counters, mock data) is in-memory: fine
 * for a single instance, replace with Redis/DB when running more than one.
 *
 * @template T
 * @param {string} key
 * @param {() => T} factory
 * @returns {T}
 */
export function singleton(key, factory) {
  const registry = (globalThis.__backofficeSingletons ??= new Map());
  if (!registry.has(key)) registry.set(key, factory());
  return registry.get(key);
}

/**
 * Fixed-window rate limiter.
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 */
export function hitRateLimit(key, limit, windowMs) {
  const buckets = singleton("rate-limit", () => new Map());
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterMs: bucket.resetAt - now };
}

export function resetRateLimit(key) {
  singleton("rate-limit", () => new Map()).delete(key);
}
