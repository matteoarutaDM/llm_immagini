import { checkMutationOrigin, clientIp, json, parseReason, readJson, withErrorHandling } from "../../../../admin/_server/http";
import { deleteDocument } from "../../../../admin/_server/services/documents";
import { requireOperator } from "../../../../admin/_server/session";

export const runtime = "nodejs";

/** DELETE { reason } — admin only; removes file, row and cached index via the backend. */
export const DELETE = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "documents:delete");
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await readJson(request);
  return json(await deleteDocument(id, parseReason(body.reason), auth.operator, clientIp(request)));
});
