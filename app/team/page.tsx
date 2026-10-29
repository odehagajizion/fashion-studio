import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import TeamClient from "./TeamClient";

type TeamMember = { user_id: string; email: string; role: "owner" | "supervisor" | "tailor"; is_active: boolean; created_at: string };

export default async function TeamPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (!membership) redirect("/setup?reason=membership");
  if (membership.role !== "owner") redirect("/dashboard");

  const { data, error } = await supabase.rpc("list_business_team");
  const members = (data ?? []) as TeamMember[];

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark">M</span><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item" href="/orders"><span className="nav-icon">▤</span>Orders</Link><Link className="nav-item" href="/calendar"><span className="nav-icon">▦</span>Calendar</Link></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><Link className="nav-item" href="/orders"><span className="nav-icon">◷</span>Production</Link><Link className="nav-item selected" href="/team" aria-current="page"><span className="nav-icon">♧</span>Team</Link></div>
        <div className="nav-group"><p className="group-label">FINANCE</p><Link className="nav-item" href="/payments"><span className="nav-icon">₦</span>Payments</Link><Link className="nav-item" href="/reports"><span className="nav-icon">▥</span>Reports</Link></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">STUDIO ACCESS</p><h1>Team</h1><p className="page-subtitle">Manage studio roles and who can access the workspace.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      {error ? <div className="notice notice-error" role="status"><span className="notice-dot" /><span><strong>Team list could not be loaded.</strong> Apply the Team Management migration, then refresh.</span></div> : <TeamClient members={members} />}
      <footer className="page-footer"><span>Access and role changes are saved to the audit history.</span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
  </main>;
}

