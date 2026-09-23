import { json, withErrorHandling } from "../../../../admin/_server/http";
import { listRecognizedMachines } from "../../../../admin/_server/services/analyses";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "analyses:view");
  if (auth.response) return auth.response;
  return json({ machines: await listRecognizedMachines() });
});
