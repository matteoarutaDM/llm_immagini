import { Suspense } from "react";

import { DocumentsView } from "../../_components/documents/DocumentsView";
import ConsoleLoading from "../loading";

export const metadata = { title: "Documenti" };

export default function DocumentsPage() {
  return (
    <Suspense fallback={<ConsoleLoading />}>
      <DocumentsView />
    </Suspense>
  );
}
