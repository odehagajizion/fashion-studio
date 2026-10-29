import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const timeZone = "Africa/Lagos";
const money = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const dateParts = (value: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value).map(part => [part.type, part.value]));
const monthKey = (value: string | Date) => {
  const parts = dateParts(typeof value === "string" ? new Date(value) : value);
  return `${parts.year}-${parts.month}`;
};
const isoBusinessDate = () => {
  const parts = dateParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const stageNames: Record<string, string> = {
  not_started: "Not started", in_production: "In production", awaiting_fitting: "Awaiting fitting", ready_for_pickup: "Ready for pickup",
};
const stageColors: Record<string, string> = { not_started: "sage", in_production: "olive", awaiting_fitting: "gold", ready_for_pickup: "red" };
const methodNames: Record<string, string> = { cash: "Cash", bank_transfer: "Transfer", card: "Card", other: "Other", refund: "Refund", reversal: "Reversal" };

export default async function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");
  const { data: membership, error: membershipError } = await supabase.from("business_memberships")
    .select("business_id, role").eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (membershipError || !membership) redirect("/setup?reason=membership");

  const businessId = membership.business_id as string;
  const role = membership.role as string;
  const canViewFinance = role === "owner" || role === "supervisor";
  const [{ data: customers, error: customerError }, { data: orderRows, error: orderError }, { data: paymentRows, error: paymentError }, { data: adjustmentRows, error: adjustmentError }] = await Promise.all([
    supabase.from("customers").select("id, first_name, last_name").eq("business_id", businessId).is("archived_at", null),
    supabase.from("orders").select("id, order_ref, customer_id, stage, due_date, created_at, fulfillment_method").eq("business_id", businessId).order("created_at", { ascending: false }),
    canViewFinance ? supabase.from("payments").select("id, order_id, amount, method, received_at, created_at").eq("business_id", businessId).order("received_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    canViewFinance ? supabase.from("payment_adjustments").select("id, payment_id, adjustment_type, amount, created_at").eq("business_id", businessId).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
  ]);
  const orders = orderRows ?? [];
  const orderIds = orders.map(order => order.id);
  const itemsResult = orderIds.length
    ? await supabase.from("order_items").select("id, order_id, quantity").eq("business_id", businessId).in("order_id", orderIds)
    : { data: [], error: null };
  const itemRows = itemsResult.data ?? [];
  const itemIds = itemRows.map(item => item.id);
  const pricesResult = canViewFinance && itemIds.length ? await supabase.from("order_item_prices").select("order_item_id, unit_price").eq("business_id", businessId).in("order_item_id", itemIds) : { data: [], error: null };
  // Tailors never receive the financial price query.
  const prices = pricesResult.data ?? [];
  const priceByItem = new Map(prices.map(row => [row.order_item_id, Number(row.unit_price)]));
  const totalsByOrder = new Map<string, number>();
  itemRows.forEach(item => totalsByOrder.set(item.order_id, (totalsByOrder.get(item.order_id) ?? 0) + item.quantity * (priceByItem.get(item.id) ?? 0)));

  const paymentRowsSafe = paymentRows ?? [];
  const adjustments = adjustmentRows ?? [];
  const adjustmentsByPayment = new Map<string, number>();
  adjustments.forEach(row => adjustmentsByPayment.set(row.payment_id, (adjustmentsByPayment.get(row.payment_id) ?? 0) + Number(row.amount)));
  const netReceivedByOrder = new Map<string, number>();
  paymentRowsSafe.forEach(payment => netReceivedByOrder.set(payment.order_id, (netReceivedByOrder.get(payment.order_id) ?? 0) + Number(payment.amount)));
  paymentRowsSafe.forEach(payment => netReceivedByOrder.set(payment.order_id, (netReceivedByOrder.get(payment.order_id) ?? 0) - (adjustmentsByPayment.get(payment.id) ?? 0)));

  const businessToday = isoBusinessDate();
  const activeOrders = orders.filter(order => order.stage !== "completed" && order.stage !== "cancelled");
  const overdueOrders = activeOrders.filter(order => order.due_date && order.due_date < businessToday);
  const stageKeys = ["not_started", "in_production", "awaiting_fitting", "ready_for_pickup"];
  const stages = stageKeys.map(key => ({ name: stageNames[key], count: activeOrders.filter(order => order.stage === key).length, color: stageColors[key] }));
  const byCustomer = new Map((customers ?? []).map(customer => [customer.id, `${customer.first_name} ${customer.last_name}`]));
  const deadlineLimit = new Date(Date.parse(`${businessToday}T12:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  const deadlines = activeOrders.filter(order => order.due_date && order.due_date <= deadlineLimit).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")).slice(0, 4).map(order => {
    const days = Math.round((Date.parse(`${order.due_date}T12:00:00Z`) - Date.parse(`${businessToday}T12:00:00Z`)) / 86400000);
    return { ref: order.order_ref, name: byCustomer.get(order.customer_id) ?? "Assigned customer", due: days < 0 ? `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue` : days === 0 ? "Due today" : days === 1 ? "Due tomorrow" : `Due in ${days} days`, tone: days < 0 ? "late" : days === 0 ? "today" : "soon" };
  });
  const recentOrders = orders.slice(0, 3).map(order => ({
    ref: order.order_ref,
    name: byCustomer.get(order.customer_id) ?? "Assigned customer",
    status: stageNames[order.stage] ?? (order.stage === "completed" ? "Completed" : "Cancelled"),
    amount: canViewFinance ? money.format(totalsByOrder.get(order.id) ?? 0) : "",
    tone: stageColors[order.stage] ?? (order.stage === "completed" ? "complete" : "late"),
  }));

  const now = new Date();
  const currentMonth = monthKey(now);
  const currentMonthParts = dateParts(now);
  const monthDates = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(Number(currentMonthParts.year), Number(currentMonthParts.month) - 6 + index, 1)));
  const paymentsByMonth = monthDates.map(date => ({ key: monthKey(date), label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(date), amount: 0 }));
  const monthlyIndex = new Map(paymentsByMonth.map((month, index) => [month.key, index]));
  if (canViewFinance) {
    paymentRowsSafe.forEach(payment => { const index = monthlyIndex.get(monthKey(payment.received_at)); if (index !== undefined) paymentsByMonth[index].amount += Number(payment.amount); });
    adjustments.forEach(adjustment => { const index = monthlyIndex.get(monthKey(adjustment.created_at)); if (index !== undefined) paymentsByMonth[index].amount -= Number(adjustment.amount); });
  }
  const receivedThisMonth = canViewFinance ? (paymentsByMonth.find(month => month.key === currentMonth)?.amount ?? 0) : 0;
  const outstanding = canViewFinance ? activeOrders.reduce((sum, order) => sum + Math.max(0, (totalsByOrder.get(order.id) ?? 0) - (netReceivedByOrder.get(order.id) ?? 0)), 0) : 0;
  const orderById = new Map(orders.map(order => [order.id, order]));
  const recentActivity = canViewFinance ? [
    ...paymentRowsSafe.map(payment => ({ id: payment.id, kind: "payment" as const, order_id: payment.order_id, amount: Number(payment.amount), method: payment.method, at: payment.received_at })),
    ...adjustments.map(adjustment => {
      const payment = paymentRowsSafe.find(row => row.id === adjustment.payment_id);
      return { id: adjustment.id, kind: "adjustment" as const, order_id: payment?.order_id ?? "", amount: Number(adjustment.amount), method: adjustment.adjustment_type, at: adjustment.created_at };
    }),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3).map(event => {
    const order = orderById.get(event.order_id);
    return { id: event.id, amount: `${event.kind === "payment" ? "+" : "−"}${money.format(event.amount)}`, name: order ? byCustomer.get(order.customer_id) ?? "Customer" : "Customer", method: methodNames[event.method] ?? event.method, date: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(event.at)), negative: event.kind === "adjustment" };
  }) : [];

  return <DashboardClient data={{
    role, canViewFinance, totalCustomers: customers?.length ?? 0, activeOrders: activeOrders.length,
    overdueOrders: overdueOrders.length, receivedThisMonth, outstanding, paymentsByMonth,
    stages, deadlines, recentOrders, recentPayments: recentActivity,
    dataError: Boolean(customerError || orderError || paymentError || adjustmentError || itemsResult.error || pricesResult.error),
  }} />;
}
