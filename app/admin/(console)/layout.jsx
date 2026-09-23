import { redirect } from "next/navigation";

import { AdminShell } from "../_components/shell/AdminShell";
import { getCurrentOperator } from "../_server/session";

/**
 * Authoritative session check for every console page: proxy.js only looks at
 * cookie presence, here the token is resolved server-side and the operator
 * (with its current role) is handed to the client shell.
 */
export default async function ConsoleLayout({ children }) {
  const operator = await getCurrentOperator();
  if (!operator) redirect("/admin/login?reason=expired");
  return <AdminShell operator={operator}>{children}</AdminShell>;
}
