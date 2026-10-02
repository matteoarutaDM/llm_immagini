import { checkMutationOrigin, clientIp, json, readJson, withErrorHandling } from "../../../../../admin/_server/http";
import { createCompanyAccount } from "../../../../../admin/_server/services/companies";
import { requireOperator } from "../../../../../admin/_server/session";

export const runtime = "nodejs";

/** POST { email, fullName, role } — admin only; the response carries the one-time temporary password. */
export const POST = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "companies:manage");
  if (auth.response) return auth.response;
  const { id } = await params;
  const body = await readJson(request);
  const result = await createCompanyAccount(
    id,
    { email: body.email, fullName: body.fullName, role: body.role ?? "company_admin" },
    auth.operator,
    clientIp(request),
  );
  return json(result, 201);
});
