import { DragEvent, useState } from "react";
import { ArrowUpTrayIcon, PhotoIcon } from "@heroicons/react/24/outline";

type ImageUploaderProps = {
  previewUrl: string | null;
  onFileChange: (file: File | null) => void;
};

export function ImageUploader({ previewUrl, onFileChange }: ImageUploaderProps) {
  const [dragActive, setDragActive] = useState(false);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFileChange(file);
  }

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-neutral-800 dark:text-neutral-200">Immagine macchina</span>
      <input
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        id="machine-image"
      />
      <span
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-6 text-center transition ${
          dragActive
            ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40"
            : "border-neutral-300 bg-neutral-50 hover:border-emerald-600 hover:bg-emerald-50/60 dark:border-neutral-700 dark:bg-neutral-950 dark:hover:bg-emerald-950/30"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Anteprima immagine caricata" className="max-h-64 w-full rounded-xl object-contain" />
        ) : (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-neutral-200/70 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <PhotoIcon className="h-6 w-6" />
            </div>
            <span className="mt-3 text-sm font-medium text-neutral-800 dark:text-neutral-200">Seleziona o trascina una foto</span>
            <span className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">JPG, PNG, WEBP</span>
          </>
        )}
      </span>
      <label
        htmlFor="machine-image"
        className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium transition hover:border-emerald-600 hover:text-emerald-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
      >
        <ArrowUpTrayIcon className="h-4 w-4" />
        Carica immagine
      </label>
    </label>
  );
}
