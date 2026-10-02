import { USER_STATUSES } from "../../../../admin/_lib/constants";
import { checkMutationOrigin, clientIp, errors, json, parseEnum, parseReason, readJson, withErrorHandling } from "../../../../admin/_server/http";
import { getUserDetail, setUserStatus } from "../../../../admin/_server/services/users";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request, { params }) => {
  const auth = await requireOperator(request, "users:view");
  if (auth.response) return auth.response;
  const { id } = await params;
  return json(await getUserDetail(id));
});

/** Block / re-enable an account (admin only). */
export const PATCH = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "users:block");
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await readJson(request);
  const status = parseEnum(body.status, USER_STATUSES);
  if (!status) return errors.badRequest("Stato non valido.");
  return json(await setUserStatus(id, status, parseReason(body.reason), auth.operator, clientIp(request)));
});
