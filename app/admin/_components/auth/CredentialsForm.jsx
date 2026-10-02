"use client";

import { useState } from "react";

import { PasswordInput } from "../../../components/PasswordInput";
import { authApi } from "../../_lib/api";
import { Button } from "../ui/Button";
import { Field, FormAlert } from "./Field";

/**
 * Step 1: email + password. The server either starts an OTP challenge or,
 * for password-only operators (support), opens the session directly.
 */
export function CredentialsForm({ onChallenge, onSignedIn, notice }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authApi.login(email.trim(), password);
      setPassword("");
      if (result.requiresOtp) onChallenge({ ...result, email: email.trim() });
      else onSignedIn(result.operator);
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      <FormAlert tone="info">{notice}</FormAlert>
      <FormAlert>{error}</FormAlert>
      <Field
        id="operator-email"
        label="Email aziendale"
        type="email"
        autoComplete="username"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="nome@azienda.it"
      />
      <div>
        <label htmlFor="operator-password" className="text-xs font-medium text-app-secondary">
          Password
        </label>
        <div className="mt-1.5">
          <PasswordInput
            id="operator-password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
        </div>
      </div>
      <Button type="submit" variant="primary" className="w-full" loading={pending} disabled={!email.trim() || !password}>
        Continua
      </Button>
    </form>
  );
}
