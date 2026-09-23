import { checkMutationOrigin, json, withErrorHandling } from "../../../../admin/_server/http";
import { SESSION_COOKIE, clearSessionCookie, destroySession } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const POST = withErrorHandling(async (request) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;

  // Server-side invalidation first: the token is useless even if it leaked.
  await destroySession(request.cookies.get(SESSION_COOKIE)?.value);
  const response = json({ ok: true });
  clearSessionCookie(response);
  return response;
});
