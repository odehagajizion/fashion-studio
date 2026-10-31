"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("We couldn’t sign you in. Check your email, password, and Supabase connection, then try again.");
      setIsSubmitting(false);
    }
  }

  return <main className="auth-shell"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
    <p className="eyebrow auth-eyebrow">OWNER WORKSPACE</p>
    <h1>Welcome back</h1>
    <p className="auth-subtitle">Sign in to manage your studio.</p>
    <form className="auth-form" onSubmit={handleSubmit}>
      <label htmlFor="email">Email address</label>
      <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
      <Link className="text-link" href="/forgot-password">Forgot password?</Link>
      {errorMessage && <p className="auth-error" role="alert">{errorMessage}</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="auth-help">Access is managed by your studio owner. Contact them if you need an account.</p>
  </section></main>;
}



