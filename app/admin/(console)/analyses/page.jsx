import { Suspense } from "react";

import { AnalysesView } from "../../_components/analyses/AnalysesView";
import ConsoleLoading from "../loading";

export const metadata = { title: "Analisi" };

/** useSearchParams (URL filters) requires a Suspense boundary. */
export default function AnalysesPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <AnalysesView />
    </Suspense>
  );
}
