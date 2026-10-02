"use client";

import { useEffect, useRef, useState } from "react";

import { authApi } from "../../_lib/api";
import { Button } from "../ui/Button";
import { FormAlert } from "./Field";

const CODE_LENGTH = 6;
// Server errors after which the challenge is gone: the operator must restart.
const TERMINAL_CODES = ["OTP_EXPIRED", "OTP_LOCKED", "OTP_RESEND_EXHAUSTED"];

function useSecondsUntil(iso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000)) : 0;
}

/**
 * Step 2: one-time code. Single numeric input (works with SMS/email autofill
 * via autocomplete="one-time-code"), auto-submits when complete.
 */
export function OtpForm({ challenge, onVerified, onRestart }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [state, setState] = useState(challenge);
  const inputRef = useRef(null);
  const resendIn = useSecondsUntil(state.resendAvailableAt);
  const expiresIn = useSecondsUntil(state.expiresAt);

  useEffect(() => inputRef.current?.focus(), []);

  async function verify(value) {
    if (pending || value.length !== CODE_LENGTH) return;
    setError(null);
    setPending(true);
    try {
      const { operator } = await authApi.verifyOtp(state.challengeToken, value);
      onVerified(operator);
    } catch (apiError) {
      if (TERMINAL_CODES.includes(apiError.code)) {
        onRestart(apiError.message);
        return;
      }
      setError(apiError.message);
      setCode("");
      inputRef.current?.focus();
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const next = await authApi.resendOtp(state.challengeToken);
      setState((current) => ({ ...current, ...next }));
      setInfo("Ti abbiamo inviato un nuovo codice.");
      setCode("");
      inputRef.current?.focus();
    } catch (apiError) {
      if (TERMINAL_CODES.includes(apiError.code)) onRestart(apiError.message);
      else setError(apiError.message);
    } finally {
      setResending(false);
    }
  }

  function onChange(event) {
    const digits = event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}
    >
      <FormAlert tone="info">{info}</FormAlert>
      <FormAlert>{error}</FormAlert>
      <div>
        <label htmlFor="operator-otp" className="text-xs font-medium text-app-secondary">
          Codice di verifica
        </label>
        <input
          ref={inputRef}
          id="operator-otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={CODE_LENGTH}
          value={code}
          onChange={onChange}
          disabled={pending}
          aria-describedby="otp-expiry"
          className="touch-target mt-1.5 w-full rounded-xl border border-app-border-strong bg-app-raised px-4 text-center font-mono text-2xl tracking-[0.6em] text-app-text outline-none transition placeholder:text-app-muted/50 focus:border-app-accent/60 focus:ring-4 focus:ring-app-accent/10"
          placeholder="••••••"
        />
        <p id="otp-expiry" className="mt-1.5 text-xs text-app-muted" aria-live="polite">
          {expiresIn > 0 ? `Il codice scade tra ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}` : "Codice scaduto: richiedine uno nuovo."}
        </p>
      </div>
      <Button type="submit" variant="primary" className="w-full" loading={pending} disabled={code.length !== CODE_LENGTH}>
        Verifica e accedi
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <button type="button" onClick={() => onRestart(null)} className="font-medium text-app-secondary transition hover:text-app-text">
          ← Cambia account
        </button>
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resendIn > 0 || resending || state.resendsLeft <= 0}
          className="font-medium text-app-secondary transition hover:text-app-accent disabled:cursor-not-allowed disabled:text-app-muted"
        >
          {resending ? "Invio…" : resendIn > 0 ? `Reinvia tra ${resendIn}s` : "Reinvia codice"}
        </button>
      </div>
    </form>
  );
}
