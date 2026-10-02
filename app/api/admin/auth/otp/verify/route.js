import { recordLoginAttempt } from "../../../../../admin/_server/audit";
import { apiError, checkMutationOrigin, clientIp, errors, json, readJson, withErrorHandling } from "../../../../../admin/_server/http";
import { hitRateLimit } from "../../../../../admin/_server/memory";
import { markOperatorLogin } from "../../../../../admin/_server/operators";
import { verifyChallenge } from "../../../../../admin/_server/otp";
import { createSession, setSessionCookie } from "../../../../../admin/_server/session";

export const runtime = "nodejs";

const FAILURES = {
  expired: [401, "OTP_EXPIRED", "Il codice è scaduto. Effettua di nuovo l'accesso."],
  locked: [401, "OTP_LOCKED", "Troppi tentativi errati. Effettua di nuovo l'accesso."],
};

export const POST = withErrorHandling(async (request) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const ip = clientIp(request);

  const limit = hitRateLimit(`otp-verify:${ip}`, 20, 15 * 60_000);
  if (!limit.allowed) return errors.tooManyRequests(limit.retryAfterMs);

  const { challengeToken, code } = await readJson(request);
  const result = await verifyChallenge(challengeToken, code);
  if (!result.ok) {
    if (result.reason === "invalid") {
      return apiError(401, "OTP_INVALID", `Codice non valido. Tentativi rimasti: ${result.attemptsLeft}.`);
    }
    const [status, errorCode, message] = FAILURES[result.reason];
    return apiError(status, errorCode, message);
  }

  const { operator } = result;
  const { token, expiresAt } = await createSession(operator, { ip, userAgent: request.headers.get("user-agent") });
  await Promise.all([markOperatorLogin(operator.id), recordLoginAttempt({ email: operator.email, operatorId: operator.id, ip, success: true })]);
  const response = json({ operator, expiresAt: new Date(expiresAt).toISOString() });
  setSessionCookie(response, token, expiresAt);
  return response;
});
