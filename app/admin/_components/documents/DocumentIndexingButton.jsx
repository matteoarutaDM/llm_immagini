"use client";

import { useState } from "react";
import { ArchiveBoxArrowDownIcon, ArrowPathIcon } from "@heroicons/react/24/outline";

import { documentsApi } from "../../_lib/api";
import { useOperator } from "../shell/OperatorProvider";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

/** Admin-only: remove a document from its company's RAG (file kept) or put it back. */
export function DocumentIndexingButton({ document, onChanged }) {
  const { can } = useOperator();
  const notify = useToast();
  const [pending, setPending] = useState(false);

  if (!can("documents:index")) return null;
  const archived = document.status === "archived" || document.status === "failed";

  async function toggle() {
    setPending(true);
    try {
      const result = await documentsApi.setIndexed(document.id, archived);
      notify({
        message: archived
          ? result.status === "indexed" ? `“${document.filename}” reindicizzato.` : `Indicizzazione di “${document.filename}” non riuscita.`
          : `“${document.filename}” escluso dalla ricerca.`,
      });
      onChanged();
    } catch (apiError) {
      notify({ message: apiError.message, tone: "error" });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      icon={archived ? ArrowPathIcon : ArchiveBoxArrowDownIcon}
      loading={pending}
      onClick={() => void toggle()}
      aria-label={archived ? `Reindicizza ${document.filename}` : `Escludi ${document.filename} dalla ricerca`}
      title={archived ? "Reindicizza" : "Escludi dalla ricerca (il file resta)"}
      className="text-app-muted"
    />
  );
}
