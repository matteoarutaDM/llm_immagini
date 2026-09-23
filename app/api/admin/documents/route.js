import { DOCUMENT_STATUSES } from "../../../admin/_lib/constants";
import { json, parseEnum, parsePagination, parseSearch, withErrorHandling } from "../../../admin/_server/http";
import { listDocuments } from "../../../admin/_server/services/documents";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "documents:view");
  if (auth.response) return auth.response;
  const params = request.nextUrl.searchParams;
  return json(
    await listDocuments({
      q: parseSearch(params.get("q")),
      status: parseEnum(params.get("status"), DOCUMENT_STATUSES),
      ...parsePagination(params),
    }),
  );
});
