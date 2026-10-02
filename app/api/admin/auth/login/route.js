import { recordLoginAttempt } from "../../../../admin/_server/audit";
import { config } from "../../../../admin/_server/config";
import { apiError, checkMutationOrigin, clientIp, errors, json, readJson, withErrorHandling } from "../../../../admin/_server/http";
import { hitRateLimit, resetRateLimit } from "../../../../admin/_server/memory";
import { authenticateOperator, markOperatorLogin } from "../../../../admin/_server/operators";
import { startChallenge } from "../../../../admin/_server/otp";
import { createSession, setSessionCookie } from "../../../../admin/_server/session";

export const runtime = "nodejs";

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

export const POST = withErrorHandling(async (request) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;

  const { email, password } = await readJson(request);
  if (typeof email !== "string" || typeof password !== "string" || !EMAIL_PATTERN.test(email.trim()) || !password || password.length > 256) {
    return errors.badRequest("Inserisci email e password valide.");
  }
  const ip = clientIp(request);
  const normalizedEmail = email.trim().toLowerCase();

  const limiterKey = `login:${ip}:${normalizedEmail}`;
  const limit = hitRateLimit(limiterKey, config.loginMaxAttempts, config.loginWindowMs);
  if (!limit.allowed) return errors.tooManyRequests(limit.retryAfterMs);

  const result = await authenticateOperator(normalizedEmail, password);
  if (result.error) {
    await recordLoginAttempt({ email: normalizedEmail, ip, success: false, failureReason: result.error === "locked" ? "locked" : "invalid_credentials" });
    // Same message for unknown email, wrong password and locked account, so
    // the response never reveals which operator emails exist.
    return apiError(401, "INVALID_CREDENTIALS", "Email o password non corrette.");
  }
  const { operator } = result;
  resetRateLimit(limiterKey);

  if (operator.requiresOtp) {
    await recordLoginAttempt({ email: normalizedEmail, operatorId: operator.id, ip, success: true, failureReason: "otp_pending" });
    return json({ requiresOtp: true, ...(await startChallenge(operator)) });
  }

  // Password-only operators (support): open the session straight away.
  const { token, expiresAt } = await createSession(operator, { ip, userAgent: request.headers.get("user-agent") });
  await Promise.all([markOperatorLogin(operator.id), recordLoginAttempt({ email: normalizedEmail, operatorId: operator.id, ip, success: true })]);
  const response = json({ requiresOtp: false, operator, expiresAt: new Date(expiresAt).toISOString() });
  setSessionCookie(response, token, expiresAt);
  return response;
});
