import { Suspense } from "react";

import { CompaniesView } from "../../_components/companies/CompaniesView";
import ConsoleLoading from "../loading";

export const metadata = { title: "Aziende" };

export default function CompaniesPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <CompaniesView />
    </Suspense>
  );
}
