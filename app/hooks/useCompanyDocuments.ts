import { useCallback, useState } from "react";

import { documentsApi } from "../lib/api";
import type { CompanyDocument } from "../types";

export function useCompanyDocuments() {
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [indexedDocument, setIndexedDocument] = useState<string | null>(null);

  function hydrate(list: CompanyDocument[]) {
    setDocuments(list);
  }

  async function upload(token: string | null, file: File | null) {
    if (!token || !file) return;
    setIndexedDocument(null);
    setUploading(true);
    try {
      const response = await documentsApi.upload(token, file);
      if (!response.ok) return;
      // The upload response only carries the new document; a successful index
      // rebuild can also flip sibling documents from "failed" to "indexed", so
      // refetch the full list rather than just prepending the new entry.
      const listResponse = await documentsApi.list(token);
      if (listResponse.ok) setDocuments(listResponse.data);
      if (response.data.status === "indexed") setIndexedDocument(response.data.filename);
    } finally {
      setUploading(false);
    }
  }

  function toggleSelected(filename: string, checked: boolean) {
    setSelectedDocuments((current) => (checked ? [...current, filename] : current.filter((item) => item !== filename)));
  }

  const dismissIndexedNotification = useCallback(() => setIndexedDocument(null), []);

  async function remove(token: string | null, document: CompanyDocument) {
    if (!token) return;
    setDeleteError(null);
    setDeletingId(document.id);
    try {
      const response = await documentsApi.delete(token, document.id);
      if (!response.ok) {
        setDeleteError(response.data.detail || "Eliminazione del documento non riuscita.");
        return;
      }
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setSelectedDocuments((current) => current.filter((filename) => filename !== document.filename));
    } finally {
      setDeletingId(null);
    }
  }

  return {
    documents,
    selectedDocuments,
    uploading,
    deletingId,
    deleteError,
    indexedDocument,
    dismissIndexedNotification,
    hydrate,
    upload,
    toggleSelected,
    remove,
  };
}

export type UseCompanyDocumentsResult = ReturnType<typeof useCompanyDocuments>;
