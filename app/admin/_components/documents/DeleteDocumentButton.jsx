"use client";

import { useState } from "react";
import { TrashIcon } from "@heroicons/react/24/outline";

import { documentsApi } from "../../_lib/api";
import { useOperator } from "../shell/OperatorProvider";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

/** Admin-only delete with confirmation; the reason goes to the audit log. */
export function DeleteDocumentButton({ document, onDeleted }) {
  const { can } = useOperator();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  if (!can("documents:delete")) return null;

  async function confirm(reason) {
    setPending(true);
    setError(null);
    try {
      await documentsApi.remove(document.id, reason);
      notify({ message: `“${document.filename}” eliminato.` });
      setOpen(false);
      onDeleted();
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon={TrashIcon}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`Elimina ${document.filename}`}
        title="Elimina documento"
        className="text-app-muted hover:bg-red-500/10! hover:text-red-300!"
      />
      <ConfirmDialog
        open={open}
        title={`Eliminare “${document.filename}”?`}
        description={`Il PDF viene cancellato definitivamente e ${document.companyDomain} non riceverà più risposte basate su questo manuale. L’operazione non si può annullare.`}
        confirmLabel="Elimina"
        tone="danger"
        reason="required"
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
