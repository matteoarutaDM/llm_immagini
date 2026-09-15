"use client";

import { useState } from "react";

import { EyeIcon, EyeSlashIcon } from "@heroicons/react/24/outline";

import { INPUT_CLASS } from "./authStyles";

type PasswordInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete?: string;
  required?: boolean;
  autoFocus?: boolean;
};

export function PasswordInput({ value, onChange, placeholder, autoComplete, required, autoFocus }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        className={`${INPUT_CLASS} pr-10`}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required={required}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 transition hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Nascondi password" : "Mostra password"}
        tabIndex={-1}
      >
        {visible ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
      </button>
    </div>
  );
}
