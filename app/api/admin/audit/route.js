import { json, parsePagination, parseSearch, withErrorHandling } from "../../../admin/_server/http";
import { listAuditLog } from "../../../admin/_server/services/audit";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "audit:view");
  if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams;
  return json(await listAuditLog({ q: parseSearch(params.get("q")), ...parsePagination(params) }));
});
