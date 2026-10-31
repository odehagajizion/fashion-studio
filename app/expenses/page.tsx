import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ExpensesClient from "./ExpensesClient";

type ExpenseRow = { id: string; expense_date: string; amount: number | string; category: "fabric_materials" | "rent_utilities" | "staff_wages" | "transport" | "marketing" | "other"; note: string | null; order_id: string | null; receipt_path: string | null; recorded_by_label: string; created_at: string; updated_at: string };
type OrderRow = { id: string; order_ref: string; customer_id: string };
type CustomerRow = { id: string; first_name: string; last_name: string };
type ActivityRow = { id: string; expense_id: string; event_type: "created" | "updated"; before_state: Record<string, unknown> | null; after_state: Record<string, unknown>; actor_label: string; created_at: string };

export default async function ExpensesPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (!membership) redirect("/setup?reason=membership");
  if (membership.role !== "owner") redirect("/dashboard");

  const businessId = membership.business_id as string;
  const [expenseResult, orderResult, activityResult] = await Promise.all([
    supabase.from("studio_expenses").select("id, expense_date, amount, category, note, order_id, receipt_path, recorded_by_label, created_at, updated_at")
      .eq("business_id", businessId).order("expense_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("orders").select("id, order_ref, customer_id").eq("business_id", businessId).order("created_at", { ascending: false }),
    supabase.from("expense_activity").select("id, expense_id, event_type, before_state, after_state, actor_label, created_at")
      .eq("business_id", businessId).order("created_at", { ascending: false }),
  ]);
  const expenses = (expenseResult.data ?? []) as ExpenseRow[];
  const orders = (orderResult.data ?? []) as OrderRow[];
  const activities = (activityResult.data ?? []) as ActivityRow[];
  const customerIds = [...new Set(orders.map(order => order.customer_id))];
  const customerResult = customerIds.length
    ? await supabase.from("customers").select("id, first_name, last_name").eq("business_id", businessId).in("id", customerIds)
    : { data: [], error: null };
  const customers = (customerResult.data ?? []) as CustomerRow[];
  const customerNames = new Map(customers.map(customer => [customer.id, `${customer.first_name} ${customer.last_name}`]));
  const orderLabels = new Map(orders.map(order => [order.id, `${order.order_ref} · ${customerNames.get(order.customer_id) ?? "Customer"}`]));
  const expenseRows = await Promise.all(expenses.map(async expense => {
      let receiptUrl: string | null = null;
      if (expense.receipt_path) {
        const { data } = await supabase.storage.from("expense-receipts").createSignedUrl(expense.receipt_path, 600);
        receiptUrl = data?.signedUrl ?? null;
      }
      return { ...expense, amount: Number(expense.amount), order_label: expense.order_id ? orderLabels.get(expense.order_id) ?? "Order" : null, receipt_url: receiptUrl };
  }));

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item" href="/orders"><span className="nav-icon">▤</span>Orders</Link><Link className="nav-item" href="/calendar"><span className="nav-icon">▦</span>Calendar</Link></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><Link className="nav-item" href="/orders"><span className="nav-icon">◷</span>Production</Link><Link className="nav-item" href="/team"><span className="nav-icon">♧</span>Team</Link></div>
        <div className="nav-group"><p className="group-label">FINANCE</p><Link className="nav-item" href="/payments"><span className="nav-icon">₦</span>Payments</Link><Link className="nav-item selected" href="/expenses" aria-current="page"><span className="nav-icon">−₦</span>Expenses</Link><Link className="nav-item" href="/reports"><span className="nav-icon">▥</span>Reports</Link></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">FINANCE</p><h1>Expenses</h1><p className="page-subtitle">Track studio spending and see its impact on orders and cash flow.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <ExpensesClient businessId={businessId} expenses={expenseRows} orders={orders.map(order => ({ id: order.id, label: orderLabels.get(order.id) ?? `${order.order_ref} · Customer` }))} activities={activities} dataError={Boolean(expenseResult.error || orderResult.error || activityResult.error || customerResult.error)} />
      <footer className="page-footer"><span>Each change is recorded in the expense audit history.</span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
  </main>;
}
