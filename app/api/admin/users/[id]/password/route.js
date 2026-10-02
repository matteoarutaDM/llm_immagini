import { checkMutationOrigin, clientIp, json, withErrorHandling } from "../../../../../admin/_server/http";
import { resetUserPassword } from "../../../../../admin/_server/services/companies";
import { requireOperator } from "../../../../../admin/_server/session";

export const runtime = "nodejs";

/** POST — admin only; new temporary password (returned once), every session of the account ends. */
export const POST = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "companies:manage");
  if (auth.response) return auth.response;
  const { id } = await params;
  return json(await resetUserPassword(id, auth.operator, clientIp(request)));
});
