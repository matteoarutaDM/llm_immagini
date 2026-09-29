"use client";

import { useState } from "react";
import { ClipboardDocumentIcon } from "@heroicons/react/24/outline";

import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

/** The backend returns a temporary password only once and never stores it in clear. */
export function TemporaryPasswordModal({ credentials, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open={Boolean(credentials)}
      onClose={onClose}
      title="Password temporanea"
      description={credentials ? `Credenziali di ${credentials.email}` : undefined}
      footer={<Button variant="primary" onClick={onClose} data-autofocus>Ho preso nota</Button>}
    >
      {credentials ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-app-bg px-3 py-2 font-mono text-base tracking-wider text-app-text">{credentials.password}</code>
            <Button
              size="sm"
              icon={ClipboardDocumentIcon}
              onClick={() => void navigator.clipboard?.writeText(credentials.password).then(() => setCopied(true))}
            >
              {copied ? "Copiata" : "Copia"}
            </Button>
          </div>
          <p className="text-xs leading-5 text-app-secondary">
            Consegnala in modo riservato: dopo la chiusura non sarà più visibile. Al primo accesso la persona accetta i
            termini e può tenere questa password o cambiarla dal suo profilo.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
