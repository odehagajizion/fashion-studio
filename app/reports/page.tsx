import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ReportsClient from "./ReportsClient";

type OrderRow = { id: string; order_ref: string; customer_id: string; stage: string; created_at: string; due_date: string | null; fulfilled_at: string | null };
type ItemRow = { id: string; order_id: string; quantity: number };
type PriceRow = { order_item_id: string; unit_price: number | string };
type CustomerRow = { id: string; first_name: string; last_name: string };
type PaymentRow = { id: string; order_id: string; amount: number | string; method: string; received_at: string };
type AdjustmentRow = { id: string; payment_id: string; adjustment_type: string; amount: number | string; reason: string; created_at: string };
type ExpenseRow = { id: string; expense_date: string; amount: number | string; category: string; order_id: string | null };

export default async function ReportsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (membershipError || !membership) redirect("/setup?reason=membership");
  if (membership.role === "tailor") redirect("/dashboard");

  const businessId = membership.business_id as string;
  const isOwner = membership.role === "owner";
  const [{ data: orderRows, error: ordersError }, { data: customerRows, error: customersError }, { data: paymentRows, error: paymentsError }, { data: adjustmentRows, error: adjustmentsError }, { data: expenseRows, error: expensesError }] = await Promise.all([
    supabase.from("orders").select("id, order_ref, customer_id, stage, created_at, due_date, fulfilled_at").eq("business_id", businessId).order("created_at", { ascending: false }),
    supabase.from("customers").select("id, first_name, last_name").eq("business_id", businessId),
    isOwner ? supabase.from("payments").select("id, order_id, amount, method, received_at").eq("business_id", businessId).order("received_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    isOwner ? supabase.from("payment_adjustments").select("id, payment_id, adjustment_type, amount, reason, created_at").eq("business_id", businessId).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    isOwner ? supabase.from("studio_expenses").select("id, expense_date, amount, category, order_id").eq("business_id", businessId).order("expense_date", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  const rawOrders = (orderRows ?? []) as OrderRow[];
  const customerNames = new Map(((customerRows ?? []) as CustomerRow[]).map(customer => [customer.id, `${customer.first_name} ${customer.last_name}`]));
  const orderIds = rawOrders.map(order => order.id);
  const itemsResult = isOwner && orderIds.length
    ? await supabase.from("order_items").select("id, order_id, quantity").eq("business_id", businessId).in("order_id", orderIds)
    : { data: [], error: null };
  const items = (itemsResult.data ?? []) as ItemRow[];
  const itemIds = items.map(item => item.id);
  const pricesResult = isOwner && itemIds.length ? await supabase.from("order_item_prices").select("order_item_id, unit_price").eq("business_id", businessId).in("order_item_id", itemIds) : { data: [], error: null };
  const prices = (pricesResult.data ?? []) as PriceRow[];
  const discountResult = isOwner && orderIds.length ? await supabase.from("order_voucher_discounts").select("order_id, discount_amount").eq("business_id", businessId).in("order_id", orderIds) : { data: [], error: null };
  const expressResult = isOwner && orderIds.length ? await supabase.from("order_express_charges").select("order_id, amount").eq("business_id", businessId).in("order_id", orderIds) : { data: [], error: null };
  const expressByOrder = new Map((expressResult.data ?? []).map(row => [row.order_id, Number(row.amount)]));
  const discountByOrder = new Map((discountResult.data ?? []).map(row => [row.order_id, Number(row.discount_amount)]));
  const payments = (paymentRows ?? []) as PaymentRow[];
  const adjustments = (adjustmentRows ?? []) as AdjustmentRow[];
  const priceByItem = new Map(prices.map(price => [price.order_item_id, Number(price.unit_price)]));
  const totalByOrder = new Map<string, number>();
  items.forEach(item => totalByOrder.set(item.order_id, (totalByOrder.get(item.order_id) ?? 0) + Number(item.quantity) * (priceByItem.get(item.id) ?? 0)));
  rawOrders.forEach(order => totalByOrder.set(order.id, Math.max(0, (totalByOrder.get(order.id) ?? 0) - (discountByOrder.get(order.id) ?? 0) + (expressByOrder.get(order.id) ?? 0))));
  const paymentById = new Map(payments.map(payment => [payment.id, payment]));
  const receivedByOrder = new Map<string, number>();
  payments.forEach(payment => receivedByOrder.set(payment.order_id, (receivedByOrder.get(payment.order_id) ?? 0) + Number(payment.amount)));
  adjustments.forEach(adjustment => {
    const payment = paymentById.get(adjustment.payment_id);
    if (payment) receivedByOrder.set(payment.order_id, (receivedByOrder.get(payment.order_id) ?? 0) - Number(adjustment.amount));
  });
  const orders = rawOrders.map(order => ({
    customer_id: order.customer_id,
    id: order.id, order_ref: order.order_ref, customer_name: customerNames.get(order.customer_id) ?? "Customer",
    stage: order.stage, created_at: order.created_at, due_date: order.due_date, fulfilled_at: order.fulfilled_at,
    order_total: isOwner ? totalByOrder.get(order.id) ?? 0 : null,
    received: isOwner ? receivedByOrder.get(order.id) ?? 0 : null,
    balance: isOwner && order.stage !== "completed" && order.stage !== "cancelled" ? Math.max(0, (totalByOrder.get(order.id) ?? 0) - (receivedByOrder.get(order.id) ?? 0)) : null,
  }));
  const orderById = new Map(rawOrders.map(order => [order.id, order]));
  const transactions = isOwner ? [
    ...payments.map(payment => ({ id: payment.id, order_id: payment.order_id, order_ref: orderById.get(payment.order_id)?.order_ref ?? "Order", customer_name: customerNames.get(orderById.get(payment.order_id)?.customer_id ?? "") ?? "Customer", type: "payment" as const, label: payment.method, amount: Number(payment.amount), date: payment.received_at, reason: "" })),
    ...adjustments.map(adjustment => {
      const payment = paymentById.get(adjustment.payment_id);
      const order = payment ? orderById.get(payment.order_id) : null;
      return { id: adjustment.id, order_id: payment?.order_id ?? "", order_ref: order?.order_ref ?? "Order", customer_name: customerNames.get(order?.customer_id ?? "") ?? "Customer", type: "adjustment" as const, label: adjustment.adjustment_type, amount: Number(adjustment.amount), date: adjustment.created_at, reason: adjustment.reason };
    }),
  ].sort((a, b) => b.date.localeCompare(a.date)) : [];
  const dataError = Boolean(ordersError || customersError || (isOwner && (paymentsError || adjustmentsError || expensesError || itemsResult.error || pricesResult.error || discountResult.error || expressResult.error)));

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item" href="/orders"><span className="nav-icon">▤</span>Orders</Link><Link className="nav-item" href="/calendar"><span className="nav-icon">▦</span>Calendar</Link></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><Link className="nav-item" href="/orders"><span className="nav-icon">◷</span>Production</Link>{membership.role === "owner" && <Link className="nav-item" href="/team"><span className="nav-icon">♧</span>Team</Link>}</div>
        <div className="nav-group"><p className="group-label">FINANCE</p>{isOwner && <><Link className="nav-item" href="/payments"><span className="nav-icon">₦</span>Payments</Link><Link className="nav-item" href="/expenses"><span className="nav-icon">−₦</span>Expenses</Link></>}<Link className="nav-item selected" href="/reports" aria-current="page"><span className="nav-icon">▥</span>Reports</Link></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">BUSINESS INSIGHTS</p><h1>Reports</h1><p className="page-subtitle">Track production performance and financial activity.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <ReportsClient orders={orders} transactions={transactions} expenses={((expenseRows ?? []) as ExpenseRow[]).map(expense => ({ ...expense, amount: Number(expense.amount) }))} isOwner={isOwner} dataError={dataError} />
      <footer className="page-footer"><span>Order value and collected payments are reported separately.</span><span>MVENDYWENDY · REPORTS</span></footer>
    </section>
  </main>;
}
