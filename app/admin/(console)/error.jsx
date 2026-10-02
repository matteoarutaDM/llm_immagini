"use client";

import { useEffect } from "react";

import { Card } from "../_components/ui/Card";
import { ErrorState } from "../_components/ui/States";

/** Segment error boundary: `retry` re-fetches and re-renders the segment (Next 16). */
export default function ConsoleError({ error, retry }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Card>
      <ErrorState
        title="Qualcosa è andato storto"
        error={{ message: "La pagina non è stata caricata correttamente. Se il problema persiste contatta il team tecnico." }}
        onRetry={retry}
      />
    </Card>
  );
}
