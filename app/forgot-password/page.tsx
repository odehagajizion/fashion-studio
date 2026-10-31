"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    setIsSending(true);
    try {
      const callback = new URL("/auth/confirm", window.location.origin);
      callback.searchParams.set("next", "/set-password?mode=recovery");
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: callback.toString() });
      if (error) throw error;
      setSent(true);
      setMessage("If an account exists for that email, a password reset link is on its way.");
    } catch {
      setErrorMessage("We couldn’t send the reset request. Check your email settings and try again.");
    } finally {
      setIsSending(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
    <p className="eyebrow auth-eyebrow">ACCOUNT RECOVERY</p>
    <h1>Forgot your password?</h1>
    <p className="auth-subtitle">Enter your account email and we’ll send a secure reset link if it matches a studio account.</p>
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required />
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      {message && <p className="auth-help" role="status">{message}</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={isSending || sent}>{isSending ? "Sending link…" : sent ? "Check your email" : "Send reset link"}</button>
    </form>
    <Link className="text-link setup-back" href="/login">← Back to sign in</Link>
  </section></main>;
}

