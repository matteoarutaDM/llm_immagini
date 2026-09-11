import { useState } from "react";

import { authApi } from "../lib/api";
import type { AuthMode } from "../types";

const TOKEN_STORAGE_KEY = "assistant-token";

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyDomain, setCompanyDomain] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  function persistToken(nextToken: string) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, nextToken);
    setTokenState(nextToken);
  }

  function clearSession() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setTokenState(null);
  }

  /** Reads a previously saved token from storage and adopts it optimistically. */
  function restoreSession(): string | null {
    const saved = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) setTokenState(saved);
    return saved;
  }

  function hydrateProfile(nextEmail: string, nextCompanyDomain: string | null) {
    setEmail(nextEmail);
    setCompanyDomain(nextCompanyDomain);
  }

  async function submitAuth(mode: "login" | "register"): Promise<{ token: string; companyDomain: string | null } | null> {
    setAuthError(null);
    setAuthInfo(null);
    const response =
      mode === "register" ? await authApi.register(email, password, termsAccepted) : await authApi.login(email, password);
    if (!response.ok) {
      setAuthError(response.data.detail ?? "Autenticazione non riuscita.");
      return null;
    }
    if (mode === "register" && !response.data.token) {
      // Email verification is required in this environment: the account
      // stays pending until the confirmation link/token is verified.
      setAuthInfo(response.data.message ?? "Controlla la tua email per confermare l'account.");
      setAuthMode("verify");
      return null;
    }
    if (!response.data.token) {
      setAuthError("Autenticazione non riuscita.");
      return null;
    }
    persistToken(response.data.token);
    setCompanyDomain(response.data.company_domain ?? null);
    return { token: response.data.token, companyDomain: response.data.company_domain ?? null };
  }

  async function verifyEmail() {
    setAuthError(null);
    const response = await authApi.verifyEmail(verificationToken);
    if (!response.ok) {
      setAuthError(response.data.detail ?? "Verifica non riuscita.");
      return;
    }
    setAuthInfo(response.data.message ?? "Email confermata. Ora puoi accedere.");
    setVerificationToken("");
    setAuthMode("login");
  }

  async function resendVerification() {
    setAuthError(null);
    setResendingVerification(true);
    try {
      const response = await authApi.resendVerification(email);
      setAuthInfo(response.data.message ?? "Se l'indirizzo esiste, riceverai una nuova email.");
    } finally {
      setResendingVerification(false);
    }
  }

  async function forgotPassword() {
    setAuthError(null);
    setForgotSubmitting(true);
    try {
      const response = await authApi.forgotPassword(forgotEmail);
      if (!response.ok) {
        setAuthError(response.data.detail ?? "Richiesta non riuscita.");
        return;
      }
      setAuthInfo(response.data.message ?? "Se l'indirizzo esiste, riceverai un'email con le istruzioni.");
      setAuthMode("login");
    } finally {
      setForgotSubmitting(false);
    }
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
    companyDomain,
    authMode,
    setAuthMode,
    authError,
    authInfo,
    setAuthError,
    setAuthInfo,
    verificationToken,
    setVerificationToken,
    termsAccepted,
    setTermsAccepted,
    resendingVerification,
    forgotEmail,
    setForgotEmail,
    forgotSubmitting,
    restoreSession,
    hydrateProfile,
    clearSession,
    submitAuth,
    verifyEmail,
    resendVerification,
    forgotPassword,
    logout,
  };
}

export type UseAuthResult = ReturnType<typeof useAuth>;
