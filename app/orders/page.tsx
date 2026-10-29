import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import OrdersClient from "./OrdersClient";

export const dynamic = "force-dynamic";

type OrderStage = "not_started" | "in_production" | "awaiting_fitting" | "ready_for_pickup" | "completed" | "cancelled";
type OrderRow = { id: string; business_id: string; customer_id: string; measurement_session_id: string | null; order_ref: string; stage: OrderStage; due_date: string | null; fitting_date: string | null; pickup_date: string | null; delivery_date: string | null; fulfillment_method: "pickup" | "delivery"; fulfilled_at: string | null; notes: string | null; created_at: string };
type ItemRow = { id: string; order_id: string; garment_name: string; description: string | null; quantity: number };
type PriceRow = { order_item_id: string; unit_price: number | string };
type CustomerRow = { id: string; first_name: string; last_name: string; customer_ref: string };
type SessionRow = { id: string; customer_id: string; taken_at: string };
type MeasurementRow = { id: string; measurement_session_id: string; field_name: string; value: number | string; unit: "cm" | "in" };
type ActivityRow = { order_id: string; activity_type: string; details: Record<string, string>; note: string | null; created_at: string };

export default async function OrdersPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) redirect("/setup?reason=environment");
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/login");

  const { data: membership, error: membershipError } = await supabase.from("business_memberships")
    .select("business_id, role").eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (membershipError || !membership) redirect("/setup?reason=membership");

  const businessId = membership.business_id as string;
  const role = membership.role as string;
  const canManage = role === "owner" || role === "supervisor";
  const { data: orderData } = await supabase.from("orders")
    .select("id, business_id, customer_id, measurement_session_id, order_ref, stage, due_date, fitting_date, pickup_date, delivery_date, fulfillment_method, fulfilled_at, notes, created_at")
    .eq("business_id", businessId).order("created_at", { ascending: false });
  const rawOrders = (orderData ?? []) as OrderRow[];
  const orderIds = rawOrders.map(order => order.id);
  const customerIds = [...new Set(rawOrders.map(order => order.customer_id))];
  const measurementSessionIds = [...new Set(rawOrders.map(order => order.measurement_session_id).filter((id): id is string => Boolean(id)))];
  const itemResult = orderIds.length ? await supabase.from("order_items")
    .select("id, order_id, garment_name, description, quantity").eq("business_id", businessId).in("order_id", orderIds) : { data: [] };
  const rawItems = (itemResult.data ?? []) as ItemRow[];
  const itemIds = rawItems.map(item => item.id);
  const [priceResult, customerResult, activityResult, orderMeasurementResult] = await Promise.all([
    canManage && itemIds.length ? supabase.from("order_item_prices").select("order_item_id, unit_price").eq("business_id", businessId).in("order_item_id", itemIds) : Promise.resolve({ data: [] }),
    customerIds.length ? supabase.from("customers").select("id, first_name, last_name, customer_ref").in("id", customerIds) : Promise.resolve({ data: [] }),
    orderIds.length ? supabase.from("order_activity").select("order_id, activity_type, details, note, created_at").eq("business_id", businessId).in("order_id", orderIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    measurementSessionIds.length ? supabase.from("measurements").select("id, measurement_session_id, field_name, value, unit").eq("business_id", businessId).in("measurement_session_id", measurementSessionIds) : Promise.resolve({ data: [] }),
  ]);
  const customers = (customerResult.data ?? []) as CustomerRow[];
  const prices = (priceResult.data ?? []) as PriceRow[];
  const activities = (activityResult.data ?? []) as ActivityRow[];
  const orderMeasurements = (orderMeasurementResult.data ?? []) as MeasurementRow[];
  const customerMap = new Map(customers.map(customer => [customer.id, customer]));
  const priceMap = new Map(prices.map(price => [price.order_item_id, Number(price.unit_price)]));
  const latestActivity = new Map<string, ActivityRow>();
  activities.forEach(activity => { if (!latestActivity.has(activity.order_id)) latestActivity.set(activity.order_id, activity); });
  const orders = rawOrders.map(order => ({
    ...order,
    customer: customerMap.get(order.customer_id) ?? null,
    items: rawItems.filter(item => item.order_id === order.id).map(item => ({ ...item, unit_price: priceMap.get(item.id) ?? null })),
    latest_activity: latestActivity.get(order.id) ?? null,
    measurements: orderMeasurements.filter(item => item.measurement_session_id === order.measurement_session_id),
  }));

  let selectableCustomers: CustomerRow[] = [];
  let selectableSessions: SessionRow[] = [];
  if (canManage) {
    const [{ data: customerRows }, { data: sessionRows }] = await Promise.all([
      supabase.from("customers").select("id, first_name, last_name, customer_ref").eq("business_id", businessId).is("archived_at", null).order("last_name"),
      supabase.from("measurement_sessions").select("id, customer_id, taken_at").eq("business_id", businessId).order("taken_at", { ascending: false }),
    ]);
    selectableCustomers = (customerRows ?? []) as CustomerRow[];
    selectableSessions = (sessionRows ?? []) as SessionRow[];
  }

  return <main className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard"><span className="brand-mark">M</span><span>MvendyWendy</span></Link>
      <nav aria-label="Main navigation">
        <div className="nav-group"><p className="group-label">MAIN</p><Link className="nav-item" href="/dashboard"><span className="nav-icon">▦</span>Dashboard</Link><Link className="nav-item" href="/customers"><span className="nav-icon">♙</span>Customers</Link><Link className="nav-item selected" href="/orders" aria-current="page"><span className="nav-icon">▤</span>Orders</Link><span className="nav-item nav-disabled"><span className="nav-icon">▦</span>Calendar</span></div>
        <div className="nav-group"><p className="group-label">MANAGEMENT</p><Link className="nav-item" href="/customers"><span className="nav-icon">⌁</span>Measurements</Link><span className="nav-item nav-disabled"><span className="nav-icon">◷</span>Production</span><span className="nav-item nav-disabled"><span className="nav-icon">♧</span>Team</span></div>
        <div className="nav-group"><p className="group-label">FINANCE</p><Link className="nav-item" href="/payments"><span className="nav-icon">₦</span>Payments</Link><span className="nav-item nav-disabled"><span className="nav-icon">▥</span>Reports</span></div>
      </nav>
    </aside>
    <section className="main-area customers-main">
      <div className="topline"><div><p className="eyebrow">ORDER WORKFLOW</p><h1>Orders</h1><p className="page-subtitle">Track garments from new order through fitting and fulfilment.</p></div><Link className="button button-secondary back-dashboard" href="/dashboard">← Dashboard</Link></div>
      <OrdersClient orders={orders} customers={selectableCustomers} measurementSessions={selectableSessions} canManage={canManage} />
      <footer className="page-footer"><span>Production stage and fulfilment are tracked separately.</span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
  </main>;
}
