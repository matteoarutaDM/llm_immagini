import { useState } from "react";
import { CpuChipIcon, DocumentMagnifyingGlassIcon, GlobeAltIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";

import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "./authStyles";
import { ANSWER_LANGUAGES } from "../lib/answerLanguage";
import { useLanguage } from "../lib/i18n";
import { BrandMark } from "./BrandMark";
import { PasswordInput } from "./PasswordInput";

export function AuthPanel({ auth, onAuthSubmit }) {
  return (
    <AuthLayout>
      {auth.authMode === "forgot" ? (
        <ForgotForm auth={auth} />
      ) : auth.authMode === "2fa" ? (
        <TwoFactorForm auth={auth} onSubmit={onAuthSubmit} />
      ) : auth.authMode === "2fa-recovery" ? (
        <RecoveryCodeForm auth={auth} onSubmit={onAuthSubmit} />
      ) : (
        <LoginForm auth={auth} onSubmit={onAuthSubmit} />
      )}
    </AuthLayout>
  );
}

/**
 * First login of an account created by the company admin (or by the platform
 * administration): the owner accepts Terms and Privacy before using the site.
 */
export function TermsGate({ auth, onAccepted }) {
  const { t } = useLanguage();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const ok = await auth.acceptTerms();
    setSubmitting(false);
    if (ok) onAccepted();
    else setError(t("Non è stato possibile registrare il consenso. Riprova."));
  }

  return (
    <AuthLayout>
      <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
        <FormIntro
          eyebrow={t("Primo accesso")}
          title={t("Benvenuto")}
          description={`${auth.profile?.company_name ? t("Il tuo account di {company} è pronto. ", { company: auth.profile.company_name }) : ""}${t("Prima di iniziare, leggi e accetta i documenti qui sotto.")}`}
        />
        <label className="flex cursor-pointer items-start gap-3 py-1 text-xs leading-5 text-app-secondary">
          <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required />
          <span>
            {t("Accetto i ")}<a className="text-app-accent hover:underline" href="/terms" target="_blank" rel="noreferrer">{t("Termini di servizio")}</a>{t(" e l’")}<a className="text-app-accent hover:underline" href="/privacy" target="_blank" rel="noreferrer">{t("Informativa sulla privacy")}</a>.
          </span>
        </label>
        <Feedback error={error} />
        <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={submitting || !accepted}>
          {submitting ? t("Salvataggio...") : t("Accetta e continua")}
        </button>
        <button className={LINK_BUTTON_CLASS} type="button" onClick={() => void auth.logout()}>{t("Esci")}</button>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({ children }) {
  const { t } = useLanguage();
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
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-app-accent">{t("Supporto tecnico aumentato")}</p>
          <h1 className="font-display mt-5 text-4xl font-semibold leading-[1.12] xl:text-5xl">
            {t("Dalla fotografia alla risposta tecnica verificabile.")}
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-app-secondary">
            {t("Riconosci il macchinario, leggi la targhetta e consulta i manuali in un unico ambiente progettato per il lavoro sul campo.")}
          </p>
          <div className="mt-9 grid max-w-lg gap-4 sm:grid-cols-3">
            <Feature icon={CpuChipIcon} label={t("Riconoscimento macchina")} />
            <Feature icon={DocumentMagnifyingGlassIcon} label={t("Fonti documentali")} />
            <Feature icon={ShieldCheckIcon} label={t("Conoscenza isolata")} />
          </div>
        </div>
        <p className="relative text-xs text-app-muted">{t("AI per manutenzione, diagnostica e consultazione tecnica.")}</p>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center px-4 py-8 sm:px-8 lg:px-12">
        <div className="absolute right-4 top-4 sm:right-8 sm:top-6">
          <AnswerLanguageSelect />
        </div>
        <div className="w-full max-w-md">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <BrandMark size="md" />
            <div>
              <p className="font-display font-semibold">Assistente Macchine</p>
              <p className="text-xs text-app-muted">Industrial AI workspace</p>
            </div>
          </div>
          {children}
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

function LoginForm({ auth, onSubmit }) {
  const { t } = useLanguage();
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro eyebrow={t("Bentornato")} title={t("Accedi")} description={t("Entra nel tuo workspace di assistenza tecnica.")} />
      <Field label={t("Email")}>
        <input className={INPUT_CLASS} type="email" placeholder={t("Email")} value={auth.email} onChange={(event) => auth.setEmail(event.target.value)} autoComplete="email" autoFocus required />
      </Field>
      <Field label={t("Password")}>
        <PasswordInput value={auth.password} onChange={auth.setPassword} placeholder={t("Password (almeno 8 caratteri)")} autoComplete="current-password" required />
      </Field>
      <Feedback info={auth.authInfo} error={auth.authError} />
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.authSubmitting}>
        {auth.authSubmitting ? t("Accesso in corso...") : t("Accedi")}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-xs leading-5 text-app-muted">{t("Le credenziali te le fornisce il responsabile della tua azienda.")}</p>
        <button className={LINK_BUTTON_CLASS} type="button" onClick={() => {
          auth.setForgotEmail(auth.email);
          auth.setAuthMode("forgot");
          auth.setAuthError(null);
          auth.setAuthInfo(null);
        }}>{t("Password dimenticata?")}</button>
      </div>
    </form>
  );
}

/** Switches the interface right away and is saved in the browser; answers are written in this language too. */
function AnswerLanguageSelect() {
  const { language, t, changeLanguage } = useLanguage();

  return (
    <label className="flex items-center gap-1.5 rounded-xl border border-app-border bg-app-raised px-2.5 text-app-secondary transition hover:border-app-border-strong focus-within:border-app-accent/60">
      <GlobeAltIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <select
        aria-label={t("Lingua")}
        className="touch-target cursor-pointer bg-transparent pr-1 text-sm text-app-text outline-none"
        value={language}
        onChange={(event) => changeLanguage(event.target.value)}
      >
        {ANSWER_LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function ForgotForm({ auth }) {
  const { t } = useLanguage();
  function onSubmit(event) {
    event.preventDefault();
    void auth.forgotPassword();
  }
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro eyebrow={t("Recupero accesso")} title={t("Password dimenticata")} description={t("Inserisci l’email associata all’account per ricevere le istruzioni.")} />
      <Field label={t("Email")}>
        <input className={INPUT_CLASS} type="email" placeholder={t("Email")} value={auth.forgotEmail} onChange={(event) => auth.setForgotEmail(event.target.value)} autoComplete="email" autoFocus required />
      </Field>
      <Feedback info={auth.authInfo} error={auth.authError} />
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={auth.forgotSubmitting}>{auth.forgotSubmitting ? t("Invio in corso...") : t("Invia istruzioni")}</button>
      <button className={LINK_BUTTON_CLASS} type="button" onClick={() => { auth.setAuthMode("login"); auth.setAuthError(null); auth.setAuthInfo(null); }}>{t("Torna al login")}</button>
    </form>
  );
}

function TwoFactorForm({ auth, onSubmit }) {
  const { t } = useLanguage();
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro
        eyebrow={t("Verifica in due passaggi")}
        title={t("Verifica in due passaggi")}
        description={t("Ti abbiamo inviato un codice via email. Inseriscilo qui sotto.")}
      />
      <Feedback info={auth.authInfo} error={auth.authError} />
      <Field label={t("Codice a 6 cifre")}>
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
          {t("Annulla")}
        </button>
        <button
          className={`${PRIMARY_BUTTON_CLASS} w-auto px-6`}
          type="submit"
          disabled={auth.twoFactorSubmitting || auth.twoFactorCode.length !== 6}
        >
          {auth.twoFactorSubmitting ? t("Verifica in corso...") : t("Verifica")}
        </button>
      </div>
      <button
        className={LINK_BUTTON_CLASS}
        type="button"
        disabled={auth.resendingTwoFactor}
        onClick={() => void auth.resendTwoFactorCode()}
      >
        {auth.resendingTwoFactor ? t("Invio in corso...") : t("Non hai ricevuto il codice? Invia di nuovo")}
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
        {t("Usa un codice di recupero")}
      </button>
    </form>
  );
}

function RecoveryCodeForm({ auth, onSubmit }) {
  const { t } = useLanguage();
  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro
        eyebrow={t("Codice di recupero")}
        title={t("Usa un codice di recupero")}
        description={t("Inserisci uno dei codici di recupero generati quando hai attivato la 2FA. Ogni codice puo' essere usato una sola volta.")}
      />
      <Feedback info={auth.authInfo} error={auth.authError} />
      <Field label={t("Codice di recupero")}>
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
          {t("Annulla")}
        </button>
        <button
          className={`${PRIMARY_BUTTON_CLASS} w-auto px-6`}
          type="submit"
          disabled={auth.twoFactorSubmitting || !auth.recoveryCode.trim()}
        >
          {auth.twoFactorSubmitting ? t("Verifica in corso...") : t("Accedi con codice di recupero")}
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
        {t("Torna al codice via email")}
      </button>
    </form>
  );
}
