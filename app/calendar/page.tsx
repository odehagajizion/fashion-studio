import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import CalendarClient from "./CalendarClient";

// Add this line to force Vercel to build this dynamically as a server page
export const dynamic = "force-dynamic";

type OrderRow = { id: string; order_ref: string; customer_id: string; stage: string; due_date: string | null; fitting_date: string | null; pickup_date: string | null; delivery_date: string | null; fulfillment_method: "pickup" | "delivery" };
type CustomerRow = { id: string; first_name: string; last_name: string };
type CalendarEvent = { id: string; order_id: string; order_ref: string; customer_name: string; date: string; type: "deadline" | "fitting" | "pickup" | "delivery"; title: string; stage: string };

export default async function CalendarPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (membershipError || !membership) redirect("/setup?reason=membership");

  const businessId = membership.business_id as string;
  const [{ data: orderRows, error: orderError }, { data: customerRows, error: customerError }] = await Promise.all([
    supabase.from("orders").select("id, order_ref, customer_id, stage, due_date, fitting_date, pickup_date, delivery_date, fulfillment_method")
      .eq("business_id", businessId).not("stage", "in", "(completed,cancelled)").order("due_date", { ascending: true }),
    supabase.from("customers").select("id, first_name, last_name").eq("business_id", businessId),
  ]);
  const orders = (orderRows ?? []) as OrderRow[];
  const customers = (customerRows ?? []) as CustomerRow[];
  const customerNames = new Map(customers.map(customer => [customer.id, `${customer.first_name} ${customer.last_name}`]));
  const events: CalendarEvent[] = [];
  orders.forEach(order => {
    const customerName = customerNames.get(order.customer_id) ?? "Assigned customer";
    const addEvent = (date: string | null, type: CalendarEvent["type"], title: string) => {
      if (date) events.push({ id: `${order.id}-${type}`, order_id: order.id, order_ref: order.order_ref, customer_name: customerName, date, type, title, stage: order.stage });
    };
    addEvent(order.fitting_date, "fitting", "Fitting appointment");
    addEvent(order.due_date, "deadline", "Promised completion");
    if (order.fulfillment_method === "pickup") addEvent(order.pickup_date, "pickup", "Customer pickup");
    if (order.fulfillment_method === "delivery") addEvent(order.delivery_date, "delivery", "Delivery");
  });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const role = membership.role as string;
  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item" href="/orders"><span className="nav-icon">▤</span>Orders</Link><Link className="nav-item selected" href="/calendar" aria-current="page"><span className="nav-icon">▦</span>Calendar</Link></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><Link className="nav-item" href="/orders"><span className="nav-icon">◷</span>Production</Link>{membership.role === "owner" && <Link className="nav-item" href="/team"><span className="nav-icon">♧</span>Team</Link>}</div>
        {(role === "owner" || role === "supervisor") && <div className="nav-group"><p className="group-label">FINANCE</p><Link className="nav-item" href="/payments"><span className="nav-icon">₦</span>Payments</Link>{role === "owner" && <Link className="nav-item" href="/expenses"><span className="nav-icon">−₦</span>Expenses</Link>}<span className="nav-item nav-disabled"><span className="nav-icon">▥</span>Reports</span></div>}
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">SCHEDULE</p><h1>Calendar</h1><p className="page-subtitle">Fittings, promised completion dates, and customer collection or delivery.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <CalendarClient events={events} dataError={Boolean(orderError || customerError)} />
      <footer className="page-footer"><span>Dates shown here come from order schedules. Update them from the Orders workspace.</span><span>MVENDYWENDY · SCHEDULE</span></footer>
    </section>
  </main>;
}