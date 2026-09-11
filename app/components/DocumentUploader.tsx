import type { CompanyDocument } from "../types";

type DocumentUploaderProps = {
  documents: CompanyDocument[];
  selectedDocuments: string[];
  uploading: boolean;
  onToggle: (filename: string, checked: boolean) => void;
  onUpload: (file: File | null) => void;
};

export function DocumentUploader({ documents, selectedDocuments, uploading, onToggle, onUpload }: DocumentUploaderProps) {
  return (
    <>
      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Documenti aziendali per la prossima chat</label>
      <div className="space-y-1">
        {documents.map((document) => (
          <label key={document.id} className="flex items-center gap-2 text-xs text-neutral-800 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={selectedDocuments.includes(document.filename)}
              onChange={(event) => onToggle(document.filename, event.target.checked)}
            />
            {document.filename}
          </label>
        ))}
      </div>
      <input
        type="file"
        accept="application/pdf"
        disabled={uploading}
        onChange={(event) => onUpload(event.target.files?.[0] ?? null)}
        className="text-xs text-neutral-700 file:mr-2 file:rounded file:border file:border-neutral-300 file:bg-white file:px-2 file:py-1 file:text-xs disabled:opacity-60 dark:text-neutral-300 dark:file:border-neutral-700 dark:file:bg-neutral-900"
        aria-label="Carica documento PDF aziendale"
      />
      {uploading ? <p className="text-xs text-neutral-500 dark:text-neutral-400">Caricamento in corso...</p> : null}
    </>
  );
}
