import { USER_STATUSES } from "../../../admin/_lib/constants";
import { json, parseEnum, parsePagination, parseSearch, withErrorHandling } from "../../../admin/_server/http";
import { listUsers } from "../../../admin/_server/services/users";
import { requireOperator } from "../../../admin/_server/session";

export const runtime = "nodejs";

export const GET = withErrorHandling(async (request) => {
  const auth = await requireOperator(request, "users:view");
  if (auth.response) return auth.response;

  const params = request.nextUrl.searchParams;
  return json(
    await listUsers({
      q: parseSearch(params.get("q")),
      status: parseEnum(params.get("status"), USER_STATUSES),
      accountType: parseEnum(params.get("accountType"), ["company", "personal"]),
      twoFactor: parseEnum(params.get("twoFactor"), ["on", "off"]),
      ...parsePagination(params),
    }),
  );
});
