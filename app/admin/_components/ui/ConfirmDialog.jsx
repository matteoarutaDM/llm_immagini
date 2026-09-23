"use client";

import { useEffect, useState } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

/**
 * Confirmation for sensitive operations, with an optional (or required)
 * free-text reason that is sent to the server for the audit log.
 *
 * @param {{ open: boolean, title: string, description?: string, confirmLabel: string, tone?: "primary" | "danger",
 *   reason?: "none" | "optional" | "required", pending?: boolean, error?: string | null,
 *   onConfirm: (reason: string) => void, onClose: () => void }} props
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "primary",
  reason = "none",
  pending = false,
  error = null,
  onConfirm,
  onClose,
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const missingReason = reason === "required" && !text.trim();

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending} data-autofocus={reason === "none" ? true : undefined}>
            Annulla
          </Button>
          <Button variant={tone} loading={pending} disabled={missingReason} onClick={() => onConfirm(text.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {reason !== "none" ? (
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">
            Motivo {reason === "required" ? "(obbligatorio)" : "(facoltativo)"}
          </span>
          <textarea
            data-autofocus
            value={text}
            maxLength={500}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-xl border border-app-border-strong bg-app-raised px-3.5 py-2.5 text-sm text-app-text outline-none placeholder:text-app-muted focus:border-app-accent/60 focus:ring-4 focus:ring-app-accent/10"
            placeholder="Verrà registrato nel log di audit"
          />
        </label>
      ) : (
        <p className="text-sm text-app-secondary">L’operazione verrà registrata nel log di audit.</p>
      )}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
