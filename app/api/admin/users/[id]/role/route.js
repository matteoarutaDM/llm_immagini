import { checkMutationOrigin, clientIp, json, readJson, withErrorHandling } from "../../../../../admin/_server/http";
import { setUserRole } from "../../../../../admin/_server/services/companies";
import { requireOperator } from "../../../../../admin/_server/session";

export const runtime = "nodejs";

/** POST { role: "employee" | "company_admin" } — admin only. */
export const POST = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "companies:manage");
  if (auth.response) return auth.response;
  const { id } = await params;
  const body = await readJson(request);
  return json(await setUserRole(id, body.role, auth.operator, clientIp(request)));
});
