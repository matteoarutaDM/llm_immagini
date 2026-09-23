import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

import { Button } from "../_components/ui/Button";
import { Card } from "../_components/ui/Card";
import { EmptyState } from "../_components/ui/States";

export default function ConsoleNotFound() {
  return (
    <Card>
      <EmptyState
        icon={MagnifyingGlassIcon}
        title="Pagina non trovata"
        description="La risorsa richiesta non esiste o è stata rimossa."
        action={<Button href="/admin" size="sm">Torna alla dashboard</Button>}
      />
    </Card>
  );
}
