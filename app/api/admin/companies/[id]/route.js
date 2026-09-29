import { json, withErrorHandling } from "../../../../admin/_server/http";
import { getCompanyDetail } from "../../../../admin/_server/services/companies";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request, { params }) => {
  const auth = await requireOperator(request, "companies:view");
  if (auth.response) return auth.response;
  const { id } = await params;
  return json(await getCompanyDetail(id));
});
