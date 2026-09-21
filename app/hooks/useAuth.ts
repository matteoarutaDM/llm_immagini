import { useState } from "react";

import { authApi } from "../lib/api";
import type { AuthMode } from "../types";

const TOKEN_STORAGE_KEY = "assistant-token";

export function useAuth() {
  const [token, setTokenState] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [companyDomain, setCompanyDomain] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
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
    if (mode === "register" && password !== confirmPassword) {
      setAuthError("Le due password non coincidono.");
      return null;
    }
    setAuthSubmitting(true);
    try {
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
      if (mode === "login" && response.data.requires_2fa) {
        setChallengeToken(response.data.challenge_token ?? null);
        setTwoFactorCode("");
        setRecoveryCode("");
        setAuthInfo("Ti abbiamo inviato un codice via email.");
        setAuthMode("2fa");
        return null;
      }
      if (!response.data.token) {
        setAuthError("Autenticazione non riuscita.");
        return null;
      }
      persistToken(response.data.token);
      setCompanyDomain(response.data.company_domain ?? null);
      return { token: response.data.token, companyDomain: response.data.company_domain ?? null };
    } finally {
      setAuthSubmitting(false);
    }
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

  function _applySession(response: { token?: string; company_domain?: string | null }) {
    if (!response.token) return null;
    persistToken(response.token);
    setCompanyDomain(response.company_domain ?? null);
    return { token: response.token, companyDomain: response.company_domain ?? null };
  }

  async function verifyTwoFactor() {
    if (!challengeToken) return null;
    setAuthError(null);
    setTwoFactorSubmitting(true);
    try {
      const response = await authApi.verify2fa(challengeToken, twoFactorCode.trim());
      if (!response.ok || !response.data.token) {
        setAuthError(response.data.detail ?? "Codice non valido.");
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
        setAuthError(response.data.detail ?? "Codice di recupero non valido.");
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
        setAuthError(response.data.detail ?? "Impossibile inviare un nuovo codice.");
        return;
      }
      setAuthInfo("Ti abbiamo inviato un nuovo codice via email.");
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
    setConfirmPassword("");
    setAuthError(null);
    setAuthInfo(null);
    setAuthMode("login");
  }

  return {
    token,
    email,
    password,
    confirmPassword,
    setConfirmPassword,
    setPassword,
    setEmail,
    companyDomain,
    authMode,
    setAuthMode,
    authError,
    authInfo,
    authSubmitting,
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
    verifyEmail,
    resendVerification,
    forgotPassword,
    verifyTwoFactor,
    verifyRecoveryCode,
    resendTwoFactorCode,
    cancelTwoFactor,
    logout,
  };
}

export type UseAuthResult = ReturnType<typeof useAuth>;
