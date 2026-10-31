import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PaymentsClient from "./PaymentsClient";

type OrderRow = { id: string; order_ref: string; customer_id: string; stage: string };
type ItemRow = { id: string; order_id: string; quantity: number };
type PriceRow = { order_item_id: string; unit_price: number | string };
type CustomerRow = { id: string; first_name: string; last_name: string };
type PaymentRow = { id: string; order_id: string; amount: number | string; method: string; reference: string | null; note: string | null; received_at: string; created_at: string };
type AdjustmentRow = { id: string; payment_id: string | null; adjustment_type: "refund" | "reversal"; amount: number | string; reason: string; created_at: string };
type PaymentEvent = { id: string; kind: string; payment_id: string | null; order_id: string; order_ref: string; customer_name: string; amount: number; method: string | null; reference: string | null; note: string | null; created_at: string; remaining_adjustable: number };
type OrderChoice = { id: string; order_ref: string; customer_name: string; stage: string; total: number; received: number; balance: number };

export default async function PaymentsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (!membership) redirect("/setup?reason=membership");
  if (membership.role === "tailor") redirect("/dashboard");

  const businessId = membership.business_id as string;
  const [orderResult, paymentResult, adjustmentResult] = await Promise.all([
    supabase.from("orders").select("id, order_ref, customer_id, stage").eq("business_id", businessId).order("created_at", { ascending: false }),
    supabase.from("payments").select("id, order_id, amount, method, reference, note, received_at, created_at").eq("business_id", businessId).order("received_at", { ascending: false }),
    supabase.from("payment_adjustments").select("id, payment_id, adjustment_type, amount, reason, created_at").eq("business_id", businessId).order("created_at", { ascending: false }),
  ]);
  const orders = (orderResult.data ?? []) as OrderRow[];
  const payments = (paymentResult.data ?? []) as PaymentRow[];
  const adjustments = (adjustmentResult.data ?? []) as AdjustmentRow[];
  const orderIds = orders.map(order => order.id);
  const customerIds = [...new Set(orders.map(order => order.customer_id))];
  const paymentIds = payments.map(payment => payment.id);
  const [itemResult, customerResult, paymentAdjustmentResult] = await Promise.all([
    orderIds.length ? supabase.from("order_items").select("id, order_id, quantity").eq("business_id", businessId).in("order_id", orderIds) : Promise.resolve({ data: [] }),
    customerIds.length ? supabase.from("customers").select("id, first_name, last_name").in("id", customerIds) : Promise.resolve({ data: [] }),
    paymentIds.length ? supabase.from("payment_adjustments").select("payment_id, amount").eq("business_id", businessId).in("payment_id", paymentIds) : Promise.resolve({ data: [] }),
  ]);
  const items = (itemResult.data ?? []) as ItemRow[];
  const customers = (customerResult.data ?? []) as CustomerRow[];
  const itemIds = items.map(item => item.id);
  const priceResult = itemIds.length ? await supabase.from("order_item_prices").select("order_item_id, unit_price").eq("business_id", businessId).in("order_item_id", itemIds) : { data: [] };
  const prices = (priceResult.data ?? []) as PriceRow[];
  const byCustomer = new Map(customers.map(customer => [customer.id, `${customer.first_name} ${customer.last_name}`]));
  const byOrder = new Map(orders.map(order => [order.id, order]));
  const orderTotals = new Map<string, number>();
  const priceByItem = new Map(prices.map(price => [price.order_item_id, Number(price.unit_price)]));
  items.forEach(item => orderTotals.set(item.order_id, (orderTotals.get(item.order_id) ?? 0) + item.quantity * (priceByItem.get(item.id) ?? 0)));
  const adjustmentByPayment = new Map<string | null, number>();
  adjustments.forEach(adjustment => adjustmentByPayment.set(adjustment.payment_id, (adjustmentByPayment.get(adjustment.payment_id) ?? 0) + Number(adjustment.amount)));
  const paidByOrder = new Map<string, number>();
  payments.forEach(payment => paidByOrder.set(payment.order_id, (paidByOrder.get(payment.order_id) ?? 0) + Number(payment.amount)));
  const adjustedByOrder = new Map<string, number>();
  payments.forEach(payment => adjustedByOrder.set(payment.order_id, (adjustedByOrder.get(payment.order_id) ?? 0) + (adjustmentByPayment.get(payment.id) ?? 0)));

  const orderChoices: OrderChoice[] = orders.map(order => {
    const total = orderTotals.get(order.id) ?? 0;
    const received = (paidByOrder.get(order.id) ?? 0) - (adjustedByOrder.get(order.id) ?? 0);
    return { id: order.id, order_ref: order.order_ref, customer_name: byCustomer.get(order.customer_id) ?? "Customer", stage: order.stage, total, received, balance: Math.max(0, total - received) };
  });
  const history: PaymentEvent[] = payments.map((payment): PaymentEvent => {
    const order = byOrder.get(payment.order_id);
    return { id: payment.id, kind: "payment", payment_id: payment.id, order_id: payment.order_id, order_ref: order?.order_ref ?? "Order", customer_name: order ? byCustomer.get(order.customer_id) ?? "Customer" : "Customer", amount: Number(payment.amount), method: payment.method, reference: payment.reference, note: payment.note, created_at: payment.received_at, remaining_adjustable: Number(payment.amount) - (adjustmentByPayment.get(payment.id) ?? 0) };
  }).concat(adjustments.map((adjustment): PaymentEvent => {
    const payment = payments.find(item => item.id === adjustment.payment_id);
    const order = payment ? byOrder.get(payment.order_id) : null;
    return { id: adjustment.id, kind: "adjustment", payment_id: null, order_id: order?.id ?? "", order_ref: order?.order_ref ?? "Order", customer_name: order ? byCustomer.get(order.customer_id) ?? "Customer" : "Customer", amount: Number(adjustment.amount), method: adjustment.adjustment_type, reference: null, note: adjustment.reason, created_at: adjustment.created_at, remaining_adjustable: 0 };
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  
  const totalReceived = payments.reduce((sum, payment) => sum + Number(payment.amount), 0) - adjustments.reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
  const outstanding = orderChoices.filter(order => order.stage !== "cancelled").reduce((sum, order) => sum + order.balance, 0);
  const receivableOrders = orderChoices.filter(order => order.stage !== "cancelled" && order.balance > 0);
  
  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark" aria-hidden="true" /><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item" href="/orders"><span className="nav-icon">▤</span>Orders</Link><span className="nav-item nav-disabled"><span className="nav-icon">▦</span>Calendar</span></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><span className="nav-item nav-disabled"><span className="nav-icon">◷</span>Production</span>{membership.role === "owner" && <Link className="nav-item" href="/team"><span className="nav-icon">♧</span>Team</Link>}</div>
        <div className="nav-group"><p className="group-label">FINANCE</p><Link className="nav-item selected" href="/payments" aria-current="page"><span className="nav-icon">₦</span>Payments</Link>{membership.role === "owner" && <Link className="nav-item" href="/expenses"><span className="nav-icon">−₦</span>Expenses</Link>}<span className="nav-item nav-disabled"><span className="nav-icon">▥</span>Reports</span></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">FINANCE</p><h1>Payments</h1><p className="page-subtitle">Record confirmed money received and keep order balances accurate.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <PaymentsClient orders={orderChoices} receivableOrders={receivableOrders} history={history} totalReceived={totalReceived} outstanding={outstanding} />
      <footer className="page-footer"><span>Every receipt and adjustment remains in the audit history.</span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
  </main>;
}