"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SetPasswordClient({ mode }: { mode: "invite" | "recovery" }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    if (password.length < 8) { setFeedback("Use at least 8 characters for your password."); return; }
    if (password !== confirmPassword) { setFeedback("The passwords do not match."); return; }
    setIsSaving(true);
    const { error } = await createClient().auth.updateUser({ password });
    if (error) { setFeedback(mode === "recovery" ? "Could not save password. Your reset link may have expired; request a new one." : "Could not save password. Your invitation may have expired; ask the owner to send a new one."); setIsSaving(false); return; }
    router.replace("/dashboard");
    router.refresh();
  }

  return <form className="auth-form" onSubmit={handleSubmit}>
    <label htmlFor="password">New password</label>
    <input id="password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required />
    <label htmlFor="confirm-password">Confirm password</label>
    <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required />
    {feedback && <p className="auth-error" role="alert">{feedback}</p>}
    <button className="button button-primary auth-submit" type="submit" disabled={isSaving}>{isSaving ? "Saving password…" : mode === "recovery" ? "Update password" : "Finish setup"}</button>
  </form>;
}

