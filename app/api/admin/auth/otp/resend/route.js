import { apiError, checkMutationOrigin, json, readJson, withErrorHandling } from "../../../../../admin/_server/http";
import { resendChallenge } from "../../../../../admin/_server/otp";

export const runtime = "nodejs";

export const POST = withErrorHandling(async (request) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;

  const { challengeToken } = await readJson(request);
  const result = await resendChallenge(challengeToken);
  if (result.ok) return json(result.state);
  if (result.reason === "cooldown") {
    const seconds = Math.ceil(result.retryAfterMs / 1000);
    return apiError(429, "OTP_RESEND_COOLDOWN", `Attendi ${seconds}s prima di richiedere un nuovo codice.`, {
      "Retry-After": String(seconds),
    });
  }
  if (result.reason === "exhausted") {
    return apiError(429, "OTP_RESEND_EXHAUSTED", "Hai raggiunto il numero massimo di invii. Effettua di nuovo l'accesso.");
  }
  return apiError(401, "OTP_EXPIRED", "La sessione di verifica è scaduta. Effettua di nuovo l'accesso.");
});
