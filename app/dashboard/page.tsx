import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    redirect("/setup?reason=environment");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/login");

  const { data: membership, error: membershipError } = await supabase
    .from("business_memberships")
    .select("business_id, role")
    .eq("user_id", data.claims.sub)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError || !membership) redirect("/setup?reason=membership");
  return <DashboardClient />;
}
