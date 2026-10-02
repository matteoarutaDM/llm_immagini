import "server-only";

/** Backoffice runtime configuration (env overrides, safe defaults). */
export const config = {
  isProduction: process.env.NODE_ENV === "production",
  sessionTtlMs: Number(process.env.BACKOFFICE_SESSION_TTL_SECONDS ?? 8 * 3600) * 1000,
  otpTtlMs: Number(process.env.BACKOFFICE_OTP_TTL_SECONDS ?? 300) * 1000,
  otpMaxAttempts: 5,
  otpResendCooldownMs: 30_000,
  otpMaxResends: 3,
  loginMaxAttempts: Number(process.env.BACKOFFICE_LOGIN_MAX_ATTEMPTS ?? 8),
  loginWindowMs: 15 * 60_000,
  // Account lockout after repeated wrong passwords (per operator, in the DB).
  operatorMaxFailedLogins: 5,
  operatorLockoutMs: 15 * 60_000,
};
