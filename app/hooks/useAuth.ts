import { useState } from "react";

import { authApi } from "../lib/api";
import { tr } from "../lib/i18n";
import type { AuthMode, CurrentUser } from "../types";

const TOKEN_STORAGE_KEY = "assistant-token";

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // The signed-in account (role, company, onboarding state). null until known.
  const [profile, setProfile] = useState<CurrentUser | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [twoFactorSubmitting, setTwoFactorSubmitting] = useState(false);
  const [resendingTwoFactor, setResendingTwoFactor] = useState(false);

  function persistToken(nextToken: string) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    setTokenState(nextToken);
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setTokenState(null);
    setProfile(null);
  }

  /** Reads a previously saved token from storage and adopts it optimistically. */
  function restoreSession(): string | null {
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) setTokenState(saved);
    return saved;
  }

  function hydrateProfile(nextProfile: CurrentUser) {
    setEmail(nextProfile.email ?? "");
    setProfile(nextProfile);
  }

  /** Login only: accounts are created by the company admin or the platform administration. */
  async function submitAuth(): Promise<{ token: string } | null> {
    setAuthError(null);
    setAuthInfo(null);
    setAuthSubmitting(true);
    try {
      const response = await authApi.login(email, password);
      if (!response.ok) {
        setAuthError(response.data.detail ?? tr("Autenticazione non riuscita."));
        return null;
      }
      if (response.data.requires_2fa) {
        setChallengeToken(response.data.challenge_token ?? null);
        setTwoFactorCode("");
        setRecoveryCode("");
        setAuthInfo(tr("Ti abbiamo inviato un codice via email."));
        setAuthMode("2fa");
        return null;
      }
      const session = _applySession(response.data);
      if (!session) setAuthError(tr("Autenticazione non riuscita."));
      return session;
    } finally {
      setAuthSubmitting(false);
    }
  }

  /** First login: records the acceptance of Terms and Privacy. */
  async function acceptTerms(): Promise<boolean> {
    if (!token) return false;
    const response = await authApi.acceptTerms(token);
    if (!response.ok) return false;
    setProfile((current) => (current ? { ...current, terms_accepted: true } : current));
    return true;
  }

  /** Optional, from the profile. The backend revokes the other sessions and returns a new token. */
  async function changePassword(currentPassword: string, newPassword: string): Promise<string | null> {
    if (!token) return tr("Sessione scaduta.");
    const response = await authApi.changePassword(token, currentPassword, newPassword);
    if (!response.ok || !response.data.token) return response.data.detail ?? tr("Cambio password non riuscito.");
    persistToken(response.data.token);
    setProfile((current) => (current ? { ...current, password_is_temporary: false } : current));
    return null;
  }

  async function forgotPassword() {
    setAuthError(null);
    setForgotSubmitting(true);
    try {
      const response = await authApi.forgotPassword(forgotEmail);
      if (!response.ok) {
        setAuthError(response.data.detail ?? tr("Richiesta non riuscita."));
        return;
      }
      setAuthInfo(response.data.message ?? tr("Se l'indirizzo esiste, riceverai un'email con le istruzioni."));
      setAuthMode("login");
    } finally {
      setForgotSubmitting(false);
    }
  }

  function _applySession(response: CurrentUser & { token?: string }) {
    if (!response.token) return null;
    const { token: nextToken, ...nextProfile } = response;
    persistToken(nextToken);
    setProfile(nextProfile);
    return { token: nextToken };
  }

  async function verifyTwoFactor() {
    if (!challengeToken) return null;
    setAuthError(null);
    setTwoFactorSubmitting(true);
    try {
      const response = await authApi.verify2fa(challengeToken, twoFactorCode.trim());
      if (!response.ok || !response.data.token) {
        setAuthError(response.data.detail ?? tr("Codice non valido."));
        return null;
      }
      const session = _applySession(response.data);
      setChallengeToken(null);
      setTwoFactorCode("");
      return session;
    } finally {
      setTwoFactorSubmitting(false);
    }
  }

  async function verifyRecoveryCode() {
    if (!challengeToken) return null;
    setAuthError(null);
    setTwoFactorSubmitting(true);
    try {
      const response = await authApi.recovery2fa(challengeToken, recoveryCode.trim());
      if (!response.ok || !response.data.token) {
        setAuthError(response.data.detail ?? tr("Codice di recupero non valido."));
        return null;
      }
      const session = _applySession(response.data);
      setChallengeToken(null);
      setRecoveryCode("");
      return session;
    } finally {
      setTwoFactorSubmitting(false);
    }
  }

  async function resendTwoFactorCode() {
    if (!challengeToken) return;
    setAuthError(null);
    setAuthInfo(null);
    setResendingTwoFactor(true);
    try {
      const response = await authApi.resend2fa(challengeToken);
      if (!response.ok) {
        setAuthError(response.data.detail ?? tr("Impossibile inviare un nuovo codice."));
        return;
      }
      setAuthInfo(tr("Ti abbiamo inviato un nuovo codice via email."));
    } finally {
      setResendingTwoFactor(false);
    }
  }

  function cancelTwoFactor() {
    setChallengeToken(null);
    setTwoFactorCode("");
    setRecoveryCode("");
    setAuthError(null);
    setAuthMode("login");
  }

  async function logout() {
    if (token) {
      await authApi.logout(token).catch(() => {});
    }
    clearSession();
    setPassword("");
    setAuthError(null);
    setAuthInfo(null);
    setAuthMode("login");
  }

  return {
    token,
    email,
    password,
    setPassword,
    setEmail,
    profile,
    companyDomain: profile?.company_domain ?? null,
    isCompanyAdmin: profile?.role === "company_admin",
    authMode,
    setAuthMode,
    authError,
    authInfo,
    authSubmitting,
    setAuthError,
    setAuthInfo,
    forgotEmail,
    setForgotEmail,
    forgotSubmitting,
    challengeToken,
    twoFactorCode,
    setTwoFactorCode,
    recoveryCode,
    setRecoveryCode,
    twoFactorSubmitting,
    resendingTwoFactor,
    restoreSession,
    hydrateProfile,
    clearSession,
    submitAuth,
    acceptTerms,
    changePassword,
    forgotPassword,
    verifyTwoFactor,
    verifyRecoveryCode,
    resendTwoFactorCode,
    cancelTwoFactor,
    logout,
  };
}

export type UseAuthResult = ReturnType<typeof useAuth>;
