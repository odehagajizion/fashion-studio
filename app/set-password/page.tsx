import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SetPasswordClient from "./SetPasswordClient";

export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getClaims();
  if (error || !auth?.claims?.sub) redirect("/login?invite=invalid");

  const { data: membership } = await supabase.from("business_memberships").select("role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (!membership || !["supervisor", "tailor"].includes(String(membership.role))) redirect("/login?invite=invalid");

  return <main className="auth-shell"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">M</span><span>MvendyWendy</span></Link>
    <p className="eyebrow auth-eyebrow">STUDIO INVITATION</p>
    <h1>Set your password</h1>
    <p className="auth-subtitle">Your studio account is ready. Choose a password to finish setting it up.</p>
    <SetPasswordClient />
  </section></main>;
}

