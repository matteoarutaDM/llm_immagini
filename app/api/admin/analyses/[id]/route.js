import { json, withErrorHandling } from "../../../../admin/_server/http";
import { getAnalysisDetail } from "../../../../admin/_server/services/analyses";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request, { params }) => {
  const auth = await requireOperator(request, "analyses:view");
  if (auth.response) return auth.response;
  const { id } = await params;
  return json({ analysis: await getAnalysisDetail(id) });
});
