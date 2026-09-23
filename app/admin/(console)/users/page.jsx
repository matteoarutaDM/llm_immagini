import { Suspense } from "react";

import { UsersView } from "../../_components/users/UsersView";
import ConsoleLoading from "../loading";

export const metadata = { title: "Utenti" };

export default function UsersPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <UsersView />
    </Suspense>
  );
}
