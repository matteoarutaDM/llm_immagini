import { checkMutationOrigin, clientIp, json, parseReason, readJson, withErrorHandling } from "../../../../admin/_server/http";
import { deleteDocument, setDocumentIndexing } from "../../../../admin/_server/services/documents";
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

/** PATCH { indexed: boolean } — admin only; removes the document from its company's RAG or puts it back. */
export const PATCH = withErrorHandling(async (request, { params }) => {
  const csrf = checkMutationOrigin(request);
  if (csrf) return csrf;
  const auth = await requireOperator(request, "documents:index");
  if (auth.response) return auth.response;

  const { id } = await params;
  const body = await readJson(request);
  return json(await setDocumentIndexing(id, body.indexed === true, auth.operator, clientIp(request)));
});
