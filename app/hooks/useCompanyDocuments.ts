import { useState } from "react";

import { documentsApi } from "../lib/api";
import type { CompanyDocument } from "../types";

export function useCompanyDocuments() {
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  function hydrate(list: CompanyDocument[]) {
    setDocuments(list);
  }

  async function upload(token: string | null, file: File | null) {
    if (!token || !file) return;
    setUploading(true);
    try {
      const response = await documentsApi.upload(token, file);
      if (response.ok) setDocuments((current) => [response.data, ...current]);
    } finally {
      setUploading(false);
    }
  }

  function toggleSelected(filename: string, checked: boolean) {
    setSelectedDocuments((current) => (checked ? [...current, filename] : current.filter((item) => item !== filename)));
  }

  return { documents, selectedDocuments, uploading, hydrate, upload, toggleSelected };
}

export type UseCompanyDocumentsResult = ReturnType<typeof useCompanyDocuments>;
