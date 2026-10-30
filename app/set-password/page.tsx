import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SetPasswordClient from "./SetPasswordClient";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  const isRecovery = mode === "recovery";
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getClaims();
  if (error || !auth?.claims?.sub) redirect("/login?recovery=invalid");

  const { data: membership } = await supabase.from("business_memberships").select("role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  const allowedRoles = isRecovery ? ["owner", "supervisor", "tailor"] : ["supervisor", "tailor"];
  if (!membership || !allowedRoles.includes(String(membership.role))) redirect("/login?recovery=invalid");

  return <main className="auth-shell"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">M</span><span>MvendyWendy</span></Link>
    <p className="eyebrow auth-eyebrow">{isRecovery ? "ACCOUNT RECOVERY" : "STUDIO INVITATION"}</p>
    <h1>{isRecovery ? "Choose a new password" : "Set your password"}</h1>
    <p className="auth-subtitle">{isRecovery ? "Choose a new password for your studio account." : "Your studio account is ready. Choose a password to finish setting it up."}</p>
    <SetPasswordClient mode={isRecovery ? "recovery" : "invite"} />
  </section></main>;
}

