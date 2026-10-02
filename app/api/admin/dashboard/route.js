import { json, withErrorHandling, parseCompanyId } from "../../../admin/_server/http";
import { getDashboard } from "../../../admin/_server/services/dashboard";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "dashboard:view");
  if (auth.response) return auth.response;
  return json(await getDashboard({ companyId: parseCompanyId(request.nextUrl.searchParams.get("company")) }));
});
