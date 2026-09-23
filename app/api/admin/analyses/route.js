import { ANALYSIS_STATUSES, KNOWLEDGE_MODES } from "../../../admin/_lib/constants";
import { json, parseEnum, parsePagination, parseSearch, withErrorHandling } from "../../../admin/_server/http";
import { listAnalyses } from "../../../admin/_server/services/analyses";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "analyses:view");
  if (auth.response) return auth.response;

  const params = request.nextUrl.searchParams;
  return json(
    await listAnalyses({
      q: parseSearch(params.get("q")),
      status: parseEnum(params.get("status"), ANALYSIS_STATUSES),
      knowledgeMode: parseEnum(params.get("knowledgeMode"), KNOWLEDGE_MODES),
      machineId: params.get("machineId")?.slice(0, 120) || null,
      userId: params.get("userId")?.slice(0, 20) || null,
      ...parsePagination(params),
    }),
  );
});
