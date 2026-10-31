import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CustomerManager from "./CustomerManager";


type CustomerRow = {
  id: string;
  customer_ref: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
};

type SessionRow = { id: string; customer_id: string; taken_at: string; notes: string | null };
type MeasurementRow = { id: string; measurement_session_id: string; field_name: string; value: number | string; unit: "cm" | "in"; note: string | null };

export default async function CustomersPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");

  const { data: membership } = await supabase.from("business_memberships")
    .select("business_id, role")
    .eq("user_id", auth.claims.sub)
    .eq("is_active", true)
    .maybeSingle();
  if (!membership) redirect("/setup?reason=membership");
  if (membership.role === "tailor") redirect("/dashboard");

  const businessId = membership.business_id as string;
  const [{ data: customers }, { data: sessions }, { data: measurements }] = await Promise.all([
    supabase.from("customers").select("id, customer_ref, first_name, last_name, phone, email, notes, created_at")
      .eq("business_id", businessId).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("measurement_sessions").select("id, customer_id, taken_at, notes")
      .eq("business_id", businessId).order("taken_at", { ascending: false }),
    supabase.from("measurements").select("id, measurement_session_id, field_name, value, unit, note")
      .eq("business_id", businessId),
  ]);

  const typedCustomers = (customers ?? []) as CustomerRow[];
  const typedSessions = (sessions ?? []) as SessionRow[];
  const typedMeasurements = (measurements ?? []) as MeasurementRow[];
  const customerSessions = typedSessions.map(session => ({
    ...session,
    measurements: typedMeasurements.filter(measurement => measurement.measurement_session_id === session.id),
  }));

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p>
          <Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link>
          <Link className="nav-item selected" href="/customers" aria-current="page"><span className="nav-icon">♙</span>Customers</Link>
          <span className="nav-item nav-disabled"><span className="nav-icon">▤</span>Orders</span>
          <span className="nav-item nav-disabled"><span className="nav-icon">▦</span>Calendar</span>
        </div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><span className="nav-item nav-disabled"><span className="nav-icon">⌁</span>Measurements</span><span className="nav-item nav-disabled"><span className="nav-icon">◷</span>Production</span><span className="nav-item nav-disabled"><span className="nav-icon">♧</span>Team</span></div>
        <div className="nav-group"><p className="group-label">FINANCE</p><span className="nav-item nav-disabled"><span className="nav-icon">₦</span>Payments</span>{membership.role === "owner" && <Link className="nav-item" href="/expenses"><span className="nav-icon">−₦</span>Expenses</Link>}<span className="nav-item nav-disabled"><span className="nav-icon">▥</span>Reports</span></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">CUSTOMER RELATIONSHIPS</p><h1>Customers</h1><p className="page-subtitle">Keep customer details and measurement history together.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <CustomerManager businessId={businessId} initialCustomers={typedCustomers} initialSessions={customerSessions} />
      <footer className="page-footer"><span>Customer records are private to your studio.</span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
  </main>;
}
