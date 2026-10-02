import { Suspense } from "react";
import { notFound } from "next/navigation";

import { AuditView } from "../../_components/audit/AuditView";
import { can } from "../../_lib/permissions";
import { getCurrentOperator } from "../../_server/session";
import ConsoleLoading from "../loading";

export const metadata = { title: "Registro attività" };

/** Admin only: support operators get a 404 rather than an empty page. */
export default async function AuditPage() {
  const operator = await getCurrentOperator();
  if (!can(operator?.role, "audit:view")) notFound();
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <AuditView />
    </Suspense>
  );
}
