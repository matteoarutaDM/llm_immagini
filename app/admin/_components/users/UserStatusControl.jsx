"use client";

import { useState } from "react";
import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";

import { usersApi } from "../../_lib/api";
import { useOperator } from "../shell/OperatorProvider";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";

/** Block / re-enable an account. Rendered only for roles with `users:block`. */
export function UserStatusControl({ user, onChanged }) {
  const { can } = useOperator();
  const notify = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  if (!can("users:block")) return null;
  const blocking = user.status === "active";

  async function confirm(reason) {
    setPending(true);
    setError(null);
    try {
      const result = await usersApi.setStatus(user.id, blocking ? "blocked" : "active", reason);
      notify({
        message: blocking
          ? `Account bloccato${result.cancelledJobs ? ` · ${result.cancelledJobs} job annullati` : ""}.`
          : "Account riabilitato.",
      });
      setOpen(false);
      onChanged(result.user);
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        variant={blocking ? "danger" : "primary"}
        size="sm"
        icon={blocking ? LockClosedIcon : LockOpenIcon}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {blocking ? "Blocca account" : "Riabilita account"}
      </Button>
      <ConfirmDialog
        open={open}
        title={blocking ? `Bloccare ${user.name}?` : `Riabilitare ${user.name}?`}
        description={
          blocking
            ? "L’utente non potrà più generare immagini e i suoi job in coda verranno annullati."
            : "L’utente potrà di nuovo inviare richieste di generazione."
        }
        confirmLabel={blocking ? "Blocca" : "Riabilita"}
        tone={blocking ? "danger" : "primary"}
        reason={blocking ? "required" : "optional"}
        pending={pending}
        error={error}
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
