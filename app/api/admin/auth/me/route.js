import { json, withErrorHandling } from "../../../../admin/_server/http";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "dashboard:view");
  if (auth.response) return auth.response;
  return json({ operator: auth.operator });
});
