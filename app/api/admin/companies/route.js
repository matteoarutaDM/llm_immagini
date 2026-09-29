import { checkMutationOrigin, clientIp, json, parsePagination, parseSearch, readJson, withErrorHandling } from "../../../admin/_server/http";
import { createCompany, listCompanies } from "../../../admin/_server/services/companies";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "companies:view");
  if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams;
  return json(await listCompanies({ q: parseSearch(params.get("q")), ...parsePagination(params) }));
});

/** POST { name, domain } — admin only. */
export const POST = withErrorHandling(async (request) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "companies:manage");
  if (auth.response) return auth.response;
  const body = await readJson(request);
  return json(await createCompany({ name: body.name, domain: body.domain }, auth.operator, clientIp(request)), 201);
});
