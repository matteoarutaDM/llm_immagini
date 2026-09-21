import { CpuChipIcon, DocumentMagnifyingGlassIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./authStyles";
import { BrandMark } from "./BrandMark";
import { PasswordInput } from "./PasswordInput";

export function AuthPanel({ auth, onAuthSubmit }) {
  return (
    <main className="min-h-dvh bg-app-bg text-app-text lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden min-h-dvh overflow-hidden border-r border-app-border lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(50,213,131,0.12),transparent_38%)]" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <p className="font-display font-semibold">Assistente Macchine</p>
            <p className="text-[11px] uppercase tracking-[0.16em] text-app-muted">Industrial AI workspace</p>
          </div>
        </div>
        <div className="relative max-w-xl py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-app-accent">Supporto tecnico aumentato</p>
          <h1 className="font-display mt-5 text-4xl font-semibold leading-[1.12] xl:text-5xl">
            Dalla fotografia alla risposta tecnica verificabile.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-app-secondary">
            Riconosci il macchinario, leggi la targhetta e consulta i manuali in un unico ambiente progettato per il lavoro sul campo.
          </p>
          <div className="mt-9 grid max-w-lg gap-4 sm:grid-cols-3">
            <Feature icon={CpuChipIcon} label="Riconoscimento macchina" />
            <Feature icon={DocumentMagnifyingGlassIcon} label="Fonti documentali" />
            <Feature icon={ShieldCheckIcon} label="Conoscenza isolata" />
          </div>
        </div>
        <p className="relative text-xs text-app-muted">AI per manutenzione, diagnostica e consultazione tecnica.</p>
      </section>

      <section className="flex min-h-dvh items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <BrandMark size="md" />
            <div>
              <p className="font-display font-semibold">Assistente Macchine</p>
              <p className="text-xs text-app-muted">Industrial AI workspace</p>
            </div>
          </div>
          {auth.authMode === "verify" ? (
            <VerifyForm auth={auth} />
          ) : auth.authMode === "forgot" ? (
            <ForgotForm auth={auth} />
          ) : auth.authMode === "2fa" ? (
            <TwoFactorForm auth={auth} onSubmit={onAuthSubmit} />
          ) : auth.authMode === "2fa-recovery" ? (
            <RecoveryCodeForm auth={auth} onSubmit={onAuthSubmit} />
          ) : (
            <LoginRegisterForm auth={auth} onSubmit={onAuthSubmit} />
          )}
        </div>
      </section>
    </main>
  );
}

function Feature({ icon: Icon, label }) {
  return (
    <div className="border-t border-app-border pt-4">
      <Icon className="h-5 w-5 text-app-accent" />
      <p className="mt-3 text-xs leading-5 text-app-secondary">{label}</p>
    </div>
  );
}

function FormIntro({ eyebrow, title, description }) {
  return (
    <div className="mb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-app-accent">{eyebrow}</p>
      <h2 className="font-display mt-3 text-3xl font-semibold text-app-text">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-app-secondary">{description}</p>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-app-secondary">{label}</span>
      {children}
    </label>
  );
}

function Feedback({ info, error }) {
  if (!info && !error) return null;
  return (
    <p className={`rounded-xl border px-3 py-2.5 text-sm ${error ? "border-red-500/20 bg-red-500/10 text-red-200" : "border-app-accent/20 bg-app-accent-soft text-app-accent"}`} role={error ? "alert" : "status"}>
      {error || info}
    </p>
  );
}

function LoginRegisterForm({ auth, onSubmit }) {
  const isRegister = auth.authMode === "register";
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro
        eyebrow={isRegister ? "Crea il tuo workspace" : "Bentornato"}
        title={isRegister ? "Inizia ora" : "Accedi"}
        description={isRegister ? "Crea un account per conservare chat e conoscenze tecniche." : "Entra nel tuo workspace di assistenza tecnica."}
      />
      <Field label="Email">
        <input className={INPUT_CLASS} type="email" placeholder="Email" value={auth.email} onChange={(event) => auth.setEmail(event.target.value)} autoComplete="email" autoFocus required />
      </Field>
      <Field label="Password">
        <PasswordInput value={auth.password} onChange={auth.setPassword} placeholder="Password (almeno 8 caratteri)" autoComplete={isRegister ? "new-password" : "current-password"} required />
      </Field>
      {isRegister ? (
        <Field label="Conferma password">
          <PasswordInput value={auth.confirmPassword} onChange={auth.setConfirmPassword} placeholder="Conferma password" autoComplete="new-password" required />
        </Field>
      ) : null}
      {isRegister ? (
        <label className="flex cursor-pointer items-start gap-3 py-1 text-xs leading-5 text-app-secondary">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={auth.termsAccepted} onChange={(event) => auth.setTermsAccepted(event.target.checked)} required />
          <span>
            Accetto i <a className="text-app-accent hover:underline" href="/terms" target="_blank" rel="noreferrer">Termini di servizio</a> e l’<a className="text-app-accent hover:underline" href="/privacy" target="_blank" rel="noreferrer">Informativa sulla privacy</a>.
          </span>
        </label>
      ) : null}
      <Feedback info={auth.authInfo} error={auth.authError} />
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.authSubmitting}>
        {auth.authSubmitting ? (isRegister ? "Registrazione in corso..." : "Accesso in corso...") : isRegister ? "Registrati" : "Accedi"}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button className={LINK_BUTTON_CLASS} type="button" disabled={auth.authSubmitting} onClick={() => {
          auth.setAuthMode(isRegister ? "login" : "register");
          auth.setAuthError(null);
          auth.setAuthInfo(null);
          auth.setConfirmPassword("");
        }}>
          {isRegister ? "Ho già un account" : "Crea un account"}
        </button>
        {!isRegister ? (
          <button className={LINK_BUTTON_CLASS} type="button" onClick={() => {
            auth.setForgotEmail(auth.email);
            auth.setAuthMode("forgot");
            auth.setAuthError(null);
            auth.setAuthInfo(null);
          }}>Password dimenticata?</button>
        ) : null}
      </div>
    </form>
  );
}

function VerifyForm({ auth }) {
  function onSubmit(event) {
    event.preventDefault();
    void auth.verifyEmail();
  }
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro eyebrow="Sicurezza account" title="Verifica la tua email" description="Incolla il token ricevuto per attivare l’account." />
      <Feedback info={auth.authInfo} error={auth.authError} />
      <Field label="Token di verifica">
        <input className={INPUT_CLASS} type="text" placeholder="Token di verifica" value={auth.verificationToken} onChange={(event) => auth.setVerificationToken(event.target.value)} autoComplete="one-time-code" autoFocus required />
      </Field>
      <button className={PRIMARY_BUTTON_CLASS} type="submit">Conferma account</button>
      <button className={LINK_BUTTON_CLASS} type="button" disabled={auth.resendingVerification || !auth.email} onClick={() => void auth.resendVerification()}>
        {auth.resendingVerification ? "Invio in corso..." : "Non hai ricevuto l’email? Invia di nuovo"}
      </button>
      <button className={LINK_BUTTON_CLASS} type="button" onClick={() => { auth.setAuthMode("login"); auth.setAuthError(null); }}>Torna al login</button>
    </form>
  );
}

function ForgotForm({ auth }) {
  function onSubmit(event) {
    event.preventDefault();
    void auth.forgotPassword();
  }
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro eyebrow="Recupero accesso" title="Password dimenticata" description="Inserisci l’email associata all’account per ricevere le istruzioni." />
      <Field label="Email">
        <input className={INPUT_CLASS} type="email" placeholder="Email" value={auth.forgotEmail} onChange={(event) => auth.setForgotEmail(event.target.value)} autoComplete="email" autoFocus required />
      </Field>
      <Feedback info={auth.authInfo} error={auth.authError} />
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.forgotSubmitting}>{auth.forgotSubmitting ? "Invio in corso..." : "Invia istruzioni"}</button>
      <button className={LINK_BUTTON_CLASS} type="button" onClick={() => { auth.setAuthMode("login"); auth.setAuthError(null); auth.setAuthInfo(null); }}>Torna al login</button>
    </form>
  );
}

function TwoFactorForm({ auth, onSubmit }) {
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro
        eyebrow="Verifica in due passaggi"
        title="Verifica in due passaggi"
        description="Ti abbiamo inviato un codice via email. Inseriscilo qui sotto."
      />
      <Feedback info={auth.authInfo} error={auth.authError} />
      <Field label="Codice a 6 cifre">
        <input
          className={`${INPUT_CLASS} text-center text-lg tracking-[0.4em]`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={auth.twoFactorCode}
          onChange={(event) => auth.setTwoFactorCode(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          autoFocus
          required
        />
      </Field>
      <div className="flex items-center justify-between gap-6 pt-1">
        <button className={LINK_BUTTON_CLASS} type="button" onClick={auth.cancelTwoFactor}>
          Annulla
        </button>
        <button
          className={`${PRIMARY_BUTTON_CLASS} w-auto px-6`}
          type="submit"
          disabled={auth.twoFactorSubmitting || auth.twoFactorCode.length !== 6}
        >
          {auth.twoFactorSubmitting ? "Verifica in corso..." : "Verifica"}
        </button>
      </div>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        disabled={auth.resendingTwoFactor}
        onClick={() => void auth.resendTwoFactorCode()}
      >
        {auth.resendingTwoFactor ? "Invio in corso..." : "Non hai ricevuto il codice? Invia di nuovo"}
      </button>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        onClick={() => {
          auth.setRecoveryCode("");
          auth.setAuthError(null);
          auth.setAuthMode("2fa-recovery");
        }}
      >
        Usa un codice di recupero
      </button>
    </form>
  );
}

function RecoveryCodeForm({ auth, onSubmit }) {
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro
        eyebrow="Codice di recupero"
        title="Usa un codice di recupero"
        description="Inserisci uno dei codici di recupero generati quando hai attivato la 2FA. Ogni codice puo' essere usato una sola volta."
      />
      <Feedback info={auth.authInfo} error={auth.authError} />
      <Field label="Codice di recupero">
        <input
          className={`${INPUT_CLASS} text-center tracking-widest`}
          type="text"
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          value={auth.recoveryCode}
          onChange={(event) => auth.setRecoveryCode(event.target.value.toUpperCase())}
          autoFocus
          required
        />
      </Field>
      <div className="flex items-center justify-between gap-6 pt-1">
        <button className={LINK_BUTTON_CLASS} type="button" onClick={auth.cancelTwoFactor}>
          Annulla
        </button>
        <button
          className={`${PRIMARY_BUTTON_CLASS} w-auto px-6`}
          type="submit"
          disabled={auth.twoFactorSubmitting || !auth.recoveryCode.trim()}
        >
          {auth.twoFactorSubmitting ? "Verifica in corso..." : "Accedi con codice di recupero"}
        </button>
      </div>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        onClick={() => {
          auth.setTwoFactorCode("");
          auth.setAuthError(null);
          auth.setAuthMode("2fa");
        }}
      >
        Torna al codice via email
      </button>
    </form>
  );
}
