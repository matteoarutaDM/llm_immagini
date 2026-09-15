import { FormEvent } from "react";

import type { UseAuthResult } from "../hooks/useAuth";
import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./authStyles";
import { BrandMark } from "./BrandMark";
import { PasswordInput } from "./PasswordInput";

type AuthPanelProps = {
  auth: UseAuthResult;
  onAuthSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function AuthPanel({ auth, onAuthSubmit }: AuthPanelProps) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      {auth.authMode === "verify" ? (
        <VerifyForm auth={auth} />
      ) : auth.authMode === "forgot" ? (
        <ForgotForm auth={auth} />
      ) : (
        <LoginRegisterForm auth={auth} onSubmit={onAuthSubmit} />
      )}
    </main>
  );
}

function LoginRegisterForm({ auth, onSubmit }: { auth: UseAuthResult; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const isRegister = auth.authMode === "register";
  return (
    <form className={CARD_CLASS} onSubmit={onSubmit}>
      <div className="flex items-center gap-3">
        <BrandMark size="lg" />
        <div>
          <h1 className="font-display text-2xl font-semibold text-neutral-950 dark:text-neutral-50">Assistente macchine</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Accedi per conservare chat e conoscenze.</p>
        </div>
      </div>
      <input
        className={INPUT_CLASS}
        type="email"
        placeholder="Email"
        value={auth.email}
        onChange={(event) => auth.setEmail(event.target.value)}
        autoComplete="email"
        autoFocus
        required
      />
      <PasswordInput
        value={auth.password}
        onChange={auth.setPassword}
        placeholder="Password (almeno 8 caratteri)"
        autoComplete={isRegister ? "new-password" : "current-password"}
        required
      />
      {isRegister ? (
        <PasswordInput
          value={auth.confirmPassword}
          onChange={auth.setConfirmPassword}
          placeholder="Conferma password"
          autoComplete="new-password"
          required
        />
      ) : null}
      {isRegister ? (
        <label className="flex items-start gap-2 text-xs leading-5 text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={auth.termsAccepted}
            onChange={(event) => auth.setTermsAccepted(event.target.checked)}
            required
          />
          <span>
            Accetto i{" "}
            <a className="text-emerald-800 underline dark:text-emerald-400" href="/terms" target="_blank" rel="noreferrer">
              Termini di servizio
            </a>{" "}
            e l&apos;
            <a className="text-emerald-800 underline dark:text-emerald-400" href="/privacy" target="_blank" rel="noreferrer">
              Informativa sulla privacy
            </a>
          </span>
        </label>
      ) : null}
      {auth.authInfo ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-400" role="status">
          {auth.authInfo}
        </p>
      ) : null}
      {auth.authError ? (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {auth.authError}
        </p>
      ) : null}
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.authSubmitting}>
        {auth.authSubmitting ? (isRegister ? "Registrazione in corso..." : "Accesso in corso...") : isRegister ? "Registrati" : "Accedi"}
      </button>
      <div className="flex items-center justify-between">
        <button
          className={LINK_BUTTON_CLASS}
          type="button"
          disabled={auth.authSubmitting}
          onClick={() => {
            auth.setAuthMode(isRegister ? "login" : "register");
            auth.setAuthError(null);
            auth.setAuthInfo(null);
            auth.setConfirmPassword("");
          }}
        >
          {isRegister ? "Ho gia un account" : "Crea un account"}
        </button>
        {!isRegister ? (
          <button
            className={LINK_BUTTON_CLASS}
            type="button"
            onClick={() => {
              auth.setForgotEmail(auth.email);
              auth.setAuthMode("forgot");
              auth.setAuthError(null);
              auth.setAuthInfo(null);
            }}
          >
            Password dimenticata?
          </button>
        ) : null}
      </div>
    </form>
  );
}

function VerifyForm({ auth }: { auth: UseAuthResult }) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void auth.verifyEmail();
  }
  return (
    <form className={CARD_CLASS} onSubmit={onSubmit}>
      <div className="flex items-center gap-3">
        <BrandMark size="md" />
        <div>
          <h1 className="font-display text-xl font-semibold text-neutral-950 dark:text-neutral-50">Verifica la tua email</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Ti abbiamo inviato un link di conferma. Incolla qui sotto il token ricevuto per attivare l&apos;account.
          </p>
        </div>
      </div>
      {auth.authInfo ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-400" role="status">
          {auth.authInfo}
        </p>
      ) : null}
      <input
        className={INPUT_CLASS}
        type="text"
        placeholder="Token di verifica"
        value={auth.verificationToken}
        onChange={(event) => auth.setVerificationToken(event.target.value)}
        autoComplete="one-time-code"
        autoFocus
        required
      />
      {auth.authError ? (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {auth.authError}
        </p>
      ) : null}
      <button className={PRIMARY_BUTTON_CLASS} type="submit">
        Conferma account
      </button>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        disabled={auth.resendingVerification || !auth.email}
        onClick={() => void auth.resendVerification()}
      >
        {auth.resendingVerification ? "Invio in corso..." : "Non hai ricevuto l'email? Invia di nuovo"}
      </button>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        onClick={() => {
          auth.setAuthMode("login");
          auth.setAuthError(null);
        }}
      >
        Torna al login
      </button>
    </form>
  );
}

function ForgotForm({ auth }: { auth: UseAuthResult }) {
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void auth.forgotPassword();
  }
  return (
    <form className={CARD_CLASS} onSubmit={onSubmit}>
      <div className="flex items-center gap-3">
        <BrandMark size="md" />
        <div>
          <h1 className="font-display text-xl font-semibold text-neutral-950 dark:text-neutral-50">Password dimenticata</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Inserisci la tua email: se l&apos;account esiste, riceverai un link per reimpostare la password.
          </p>
        </div>
      </div>
      <input
        className={INPUT_CLASS}
        type="email"
        placeholder="Email"
        value={auth.forgotEmail}
        onChange={(event) => auth.setForgotEmail(event.target.value)}
        autoComplete="email"
        autoFocus
        required
      />
      {auth.authInfo ? (
        <p className="text-sm text-emerald-800 dark:text-emerald-400" role="status">
          {auth.authInfo}
        </p>
      ) : null}
      {auth.authError ? (
        <p className="text-sm text-red-700 dark:text-red-400" role="alert">
          {auth.authError}
        </p>
      ) : null}
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.forgotSubmitting}>
        {auth.forgotSubmitting ? "Invio in corso..." : "Invia istruzioni"}
      </button>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        onClick={() => {
          auth.setAuthMode("login");
          auth.setAuthError(null);
          auth.setAuthInfo(null);
        }}
      >
        Torna al login
      </button>
    </form>
  );
}
