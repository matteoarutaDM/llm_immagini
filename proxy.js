import { NextResponse } from "next/server";

/**
 * Optimistic gate for the backoffice pages: without a session cookie there is
 * no point rendering /admin/*, so redirect to the login page straight away.
 * This is NOT the authorisation layer: the (console) layout validates the
 * session server-side and every /api/admin route enforces role permissions.
 */

const SESSION_COOKIE = "bo_session";
const PUBLIC_ADMIN_PATHS = ["/admin/login"];

export function proxy(request) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
