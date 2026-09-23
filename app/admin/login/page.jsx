import { Suspense } from "react";
import { redirect } from "next/navigation";

import { LoginFlow } from "../_components/auth/LoginFlow";
import { getCurrentOperator } from "../_server/session";

export const metadata = { title: "Accesso operatori" };

export default async function AdminLoginPage() {
  if (await getCurrentOperator()) redirect("/admin");
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_15%,rgba(50,213,131,0.10),transparent_40%)]" aria-hidden="true" />
      <Suspense fallback={null}>
        <LoginFlow />
      </Suspense>
    </main>
  );
}
