"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Customer = { id: string; first_name: string; last_name: string; customer_ref: string };
type Voucher = { id: string; code: string; discount_percentage: number; expires_at: string };
type TeamMember = { user_id: string; email: string; role: "supervisor" | "tailor" };
type MeasurementSession = { id: string; customer_id: string; taken_at: string };
type OrderStage = "not_started" | "in_production" | "awaiting_fitting" | "ready_for_pickup" | "completed" | "cancelled";
type OrderItem = { id: string; order_id: string; garment_name: string; description: string | null; quantity: number; estimated_hours: number; unit_price: number | null };
type Order = {
  id: string; order_ref: string; customer_id: string; measurement_session_id: string | null; stage: OrderStage;
  due_date: string | null; fitting_date: string | null; pickup_date: string | null; delivery_date: string | null;
  fulfillment_method: "pickup" | "delivery"; fulfilled_at: string | null; notes: string | null; created_at: string; discount_amount: number; express_fee_amount: number; is_express: boolean;
  customer: Customer | null; items: OrderItem[]; measurements: { id: string; field_name: string; value: number | string; unit: "cm" | "in" }[]; assignments: { user_id: string; email: string }[]; activity: Activity[];
};
type Activity = { activity_type: string; details: Record<string, unknown>; note: string | null; created_at: string; actor_label: string; member_label: string | null };
type NewGarment = { garment_name: string; description: string; quantity: string; unit_price: string; estimated_hours: string };
const stages: { value: OrderStage; label: string }[] = [
  { value: "not_started", label: "Not started" }, { value: "in_production", label: "In production" },
  { value: "awaiting_fitting", label: "Awaiting fitting" }, { value: "ready_for_pickup", label: "Ready for pickup" },
  { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" },
];
const stageTone: Record<OrderStage, string> = { not_started: "neutral", in_production: "olive", awaiting_fitting: "gold", ready_for_pickup: "ready", completed: "complete", cancelled: "late" };
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
function localDate() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function displayDate(value: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Not set"; }
function activityChanges(item: Activity) {
  if (item.activity_type !== "schedule_changed") return [];
  const before = item.details.before as Record<string, unknown> | undefined;
  const after = item.details.after as Record<string, unknown> | undefined;
  if (!before || !after) return [];
  const labels: Record<string, string> = { due_date: "Promised completion", fitting_date: "Fitting", pickup_date: "Pickup", delivery_date: "Delivery", fulfillment_method: "Fulfilment" };
  return Object.keys(labels).filter(key => before[key] !== after[key]).map(key => {
    const format = (value: unknown) => value == null ? "Not set" : key === "fulfillment_method" ? String(value).replaceAll("_", " ") : displayDate(String(value));
    return labels[key] + ": " + format(before[key]) + " → " + format(after[key]);
  });
}
function activityTitle(item: Activity) {
  const details = item.details;
  if (item.activity_type === "created") return "Order created";
  if (item.activity_type === "stage_changed") return "Stage changed: " + String(details.from ?? "—").replaceAll("_", " ") + " → " + String(details.to ?? "—").replaceAll("_", " ");
  if (item.activity_type === "schedule_changed") return "Schedule updated";
  if (item.activity_type === "fulfilled") return "Order fulfilled";
  if (item.activity_type === "assignment_changed") return (details.action === "assigned" ? "Assigned " : "Unassigned ") + (item.member_label ?? "team member");
  return "Order updated";
}

export default function OrdersClient({ orders, customers, measurementSessions, canManage, team, activeTailorCount, queuedHours, queuedOrderCount, expressFeePercentage }: {
  orders: Order[]; customers: Customer[]; measurementSessions: MeasurementSession[]; canManage: boolean; team: TeamMember[];
  activeTailorCount: number; queuedHours: number; queuedOrderCount: number; expressFeePercentage: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [voucherId, setVoucherId] = useState("");
  const [isExpress, setIsExpress] = useState(false);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherLinkingId, setVoucherLinkingId] = useState<string | null>(null);
  const [measurementSessionId, setMeasurementSessionId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [fittingDate, setFittingDate] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"pickup" | "delivery">("pickup");
  const [pickupDate, setPickupDate] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [garments, setGarments] = useState<NewGarment[]>([{ garment_name: "", description: "", quantity: "1", unit_price: "", estimated_hours: "8" }]);
  const [isSaving, setIsSaving] = useState(false);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [scheduleEditingId, setScheduleEditingId] = useState<string | null>(null);
  const [savingScheduleId, setSavingScheduleId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<{ dueDate: string; fittingDate: string; pickupDate: string; deliveryDate: string; fulfillmentMethod: "pickup" | "delivery" } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [assignmentSelections, setAssignmentSelections] = useState<Record<string, string>>({});
  const [savingAssignment, setSavingAssignment] = useState<string | null>(null);

  const activeOrders = orders.filter(order => order.stage !== "completed" && order.stage !== "cancelled");
  const overdueOrders = activeOrders.filter(order => order.due_date && order.due_date < localDate());
  const inProduction = activeOrders.filter(order => order.stage === "in_production").length;
  const visibleOrders = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return orders.filter(order => {
      const matchesStage = stageFilter === "all" || order.stage === stageFilter;
      const searchText = `${order.order_ref} ${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""} ${order.items.map(item => item.garment_name).join(" ")}`.toLocaleLowerCase();
      return matchesStage && (!needle || searchText.includes(needle));
    }).sort((a, b) => Number(b.is_express) - Number(a.is_express) || b.created_at.localeCompare(a.created_at));
  }, [orders, query, stageFilter]);
  const availableSessions = measurementSessions.filter(session => session.customer_id === customerId);
  const subtotal = garments.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0);
  const selectedVoucher = vouchers.find(voucher => voucher.id === voucherId);
  const discount = selectedVoucher ? Math.round(subtotal * selectedVoucher.discount_percentage) / 100 : 0;
  const expressFee = isExpress ? Math.round((subtotal - discount) * expressFeePercentage) / 100 : 0;
  const estimatedTotal = subtotal - discount + expressFee;
  const newOrderHours = garments.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.estimated_hours) || 0), 0);
  const dailyThroughput = activeTailorCount * 8;
  const suggestedDays = dailyThroughput > 0 && newOrderHours > 0 ? Math.ceil((queuedHours + newOrderHours) / dailyThroughput) + 1 : null;
  function addWorkdays(from: string, count: number) {
    const [year, month, day] = from.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1, day, 12)); let added = 0;
    while (added < count) { date.setUTCDate(date.getUTCDate() + 1); if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) added++; }
    return date.toISOString().slice(0, 10);
  }
  const suggestedReadyDate = suggestedDays === null ? "" : addWorkdays(localDate(), suggestedDays);
  const selectedDateIsEarly = Boolean(dueDate && suggestedReadyDate && dueDate < suggestedReadyDate);

  function selectReadyDate(value: string) {
    if (value && suggestedReadyDate && value < suggestedReadyDate && !isExpress) {
      if (window.confirm("This date is ahead of studio capacity. Apply express fee?")) setIsExpress(true);
      else { setDueDate(suggestedReadyDate); return; }
    }
    if (value && suggestedReadyDate && value >= suggestedReadyDate && isExpress) setIsExpress(false);
    setDueDate(value);
  }

  async function loadVouchers(id: string) {
    setVouchers([]); setVoucherId("");
    if (!id) return;
    setVoucherLoading(true);
    const { data } = await createClient().rpc("list_active_customer_vouchers", { p_customer_id: id });
    setVouchers((data ?? []) as Voucher[]); setVoucherLoading(false);
  }

  function resetForm() {
    setShowForm(false); setCustomerId(""); setMeasurementSessionId(""); setVouchers([]); setVoucherId(""); setDueDate(""); setFittingDate("");
    setPickupDate(""); setDeliveryDate(""); setFulfillmentMethod("pickup"); setNotes(""); setIsExpress(false);
    setGarments([{ garment_name: "", description: "", quantity: "1", unit_price: "", estimated_hours: "8" }]); setFeedback("");
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback("");
    const cleanGarments = garments.map(item => ({ ...item, garment_name: item.garment_name.trim(), description: item.description.trim(), quantity: Number(item.quantity), unit_price: Number(item.unit_price), estimated_hours: Number(item.estimated_hours) }));
    if (cleanGarments.some(item => !item.garment_name || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unit_price) || item.unit_price < 0 || !Number.isFinite(item.estimated_hours) || item.estimated_hours <= 0 || item.estimated_hours > 500) || garments.some(item => !item.unit_price.trim())) {
      setFeedback("Enter a garment name, whole-number quantity, valid price, and labor estimate (up to 500 hours) for every line."); return;
    }
    let expressForOrder = isExpress;
    if (selectedDateIsEarly && !expressForOrder) {
      if (!window.confirm("This date is ahead of studio capacity. Apply express fee?")) { setDueDate(suggestedReadyDate); return; }
      expressForOrder = true; setIsExpress(true);
    }
    if (expressForOrder && activeTailorCount === 0) { setFeedback("An express order needs at least one active tailor."); return; }
    if (expressForOrder && (!dueDate || !suggestedReadyDate || dueDate >= suggestedReadyDate)) { setFeedback("Choose a ready date earlier than the suggested date to apply the express fee."); return; }
    setIsSaving(true);
    const { error } = await createClient().rpc("create_order_with_capacity", {
      p_customer_id: customerId,
      p_measurement_session_id: measurementSessionId || null,
      p_due_date: dueDate || null,
      p_fitting_date: fittingDate || null,
      p_pickup_date: fulfillmentMethod === "pickup" ? pickupDate || null : null,
      p_delivery_date: fulfillmentMethod === "delivery" ? deliveryDate || null : null,
      p_fulfillment_method: fulfillmentMethod,
      p_notes: notes.trim() || null,
      p_items: cleanGarments.map(item => ({ garment_name: item.garment_name, description: item.description || null, quantity: item.quantity, unit_price: item.unit_price, estimated_hours: item.estimated_hours })),
      p_voucher_id: voucherId || null,
      p_is_express: expressForOrder,
    });
    if (error) { setFeedback("We couldn’t create this order. Check the customer, dates, and garment details, then try again."); setIsSaving(false); return; }
    setIsSaving(false); resetForm(); router.refresh();
  }

  async function changeStage(orderId: string, nextStage: OrderStage) {
    setFeedback(""); setSavingOrderId(orderId);
    const { error } = await createClient().rpc("update_order_stage", { p_order_id: orderId, p_stage: nextStage, p_note: null });
    if (error) { setFeedback("That production stage could not be saved. Refresh the page and try again."); setSavingOrderId(null); return; }
    setSavingOrderId(null); router.refresh();
  }

  async function completeFulfillment(order: Order) {
    const verb = order.fulfillment_method === "delivery" ? "delivered" : "collected";
    if (!window.confirm(`Confirm that ${order.order_ref} was ${verb}? This records the actual fulfilment time.`)) return;
    setSavingOrderId(order.id); setFeedback("");
    const { error } = await createClient().rpc("complete_order_fulfillment", { p_order_id: order.id, p_note: null });
    if (error) { setFeedback("We couldn’t record fulfilment. Refresh the page and try again."); setSavingOrderId(null); return; }
    setSavingOrderId(null); router.refresh();
  }

  async function sendThankYouVoucher(order: Order) {
    setVoucherLinkingId(order.id); setFeedback("");
    const popup = window.open("about:blank", "_blank");
    try {
      const response = await fetch("/api/vouchers/whatsapp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: order.id }) });
      const result = await response.json();
      if (!response.ok || !result.whatsappUrl) throw new Error(result.error ?? "Could not create WhatsApp link.");
      if (popup) popup.location.href = result.whatsappUrl; else window.location.href = result.whatsappUrl;
    } catch (error) { popup?.close(); setFeedback(error instanceof Error ? error.message : "Could not create WhatsApp link."); }
    finally { setVoucherLinkingId(null); }
  }

  async function changeAssignment(orderId: string, userId: string, action: "assign" | "unassign") {
    setFeedback(""); setSavingAssignment(`${orderId}:${userId}`);
    const { error } = await createClient().rpc(action === "assign" ? "assign_order_to_member" : "unassign_order_member", { p_order_id: orderId, p_user_id: userId });
    if (error) { setFeedback("We couldn’t update the production assignment. Refresh the page and try again."); setSavingAssignment(null); return; }
    setSavingAssignment(null); router.refresh();
  }

  function beginScheduleEdit(order: Order) {
    setScheduleEditingId(order.id);
    setScheduleDraft({ dueDate: order.due_date ?? "", fittingDate: order.fitting_date ?? "", pickupDate: order.pickup_date ?? "", deliveryDate: order.delivery_date ?? "", fulfillmentMethod: order.fulfillment_method });
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>, orderId: string) {
    event.preventDefault();
    if (!scheduleDraft) return;
    setSavingScheduleId(orderId); setFeedback("");
    const { error } = await createClient().rpc("update_order_schedule", {
      p_order_id: orderId, p_due_date: scheduleDraft.dueDate || null, p_fitting_date: scheduleDraft.fittingDate || null,
      p_pickup_date: scheduleDraft.fulfillmentMethod === "pickup" ? scheduleDraft.pickupDate || null : null,
      p_delivery_date: scheduleDraft.fulfillmentMethod === "delivery" ? scheduleDraft.deliveryDate || null : null,
      p_fulfillment_method: scheduleDraft.fulfillmentMethod, p_note: null,
    });
    if (error) { setFeedback("We couldn’t update the schedule. Refresh the page and try again."); setSavingScheduleId(null); return; }
    setSavingScheduleId(null); setScheduleEditingId(null); setScheduleDraft(null); router.refresh();
  }
  return <div className="orders-workspace">
    <div className="orders-summary">
      <div><span>Active orders</span><strong>{activeOrders.length}</strong></div>
      <div><span>In production</span><strong>{inProduction}</strong></div>
      <div className={overdueOrders.length ? "summary-alert" : ""}><span>Overdue</span><strong>{overdueOrders.length}</strong></div>
      {canManage && <button className="button button-primary" onClick={() => { setFeedback(""); setShowForm(value => !value); }}>＋ New order</button>}
    </div>
    {!canManage && <div className="role-note">You’re seeing orders assigned to your account. Update production stages from each order card.</div>}
    {feedback && <p className="customer-feedback" role="status">{feedback}</p>}

    {showForm && canManage && <section className="order-form-card">
      <div className="customer-form-heading"><div><p className="eyebrow">NEW WORK</p><h2>Create an order</h2></div><button className="close-button" onClick={resetForm} aria-label="Close order form">×</button></div>
      {customers.length === 0 ? <div className="order-no-customers"><p>Add a customer before creating an order.</p><Link className="text-link" href="/customers">Go to customers →</Link></div> : <form className="order-form" onSubmit={createOrder}>
        <label className="form-wide">Customer<select required value={customerId} onChange={event => { setCustomerId(event.target.value); setMeasurementSessionId(""); void loadVouchers(event.target.value); }}><option value="">Choose a customer</option>{customers.map(customer => <option value={customer.id} key={customer.id}>{customer.first_name} {customer.last_name} · {customer.customer_ref}</option>)}</select></label>
        <label className="form-wide">Voucher <span className="optional">Optional</span><select value={voucherId} onChange={event => setVoucherId(event.target.value)} disabled={!customerId || voucherLoading || vouchers.length === 0}><option value="">{voucherLoading ? "Checking available vouchers…" : vouchers.length ? "No voucher applied" : "No active vouchers for this customer"}</option>{vouchers.map(voucher => <option value={voucher.id} key={voucher.id}>{voucher.code} · {voucher.discount_percentage}% off · expires {new Date(voucher.expires_at).toLocaleDateString("en-GB")}</option>)}</select></label>
        <label className="form-wide">Measurements for this order <span className="optional">Optional</span><select value={measurementSessionId} onChange={event => setMeasurementSessionId(event.target.value)} disabled={!customerId}><option value="">No measurement session selected</option>{availableSessions.map(session => <option value={session.id} key={session.id}>{displayDate(session.taken_at)}</option>)}</select></label>
        <div className="garment-lines form-wide"><div className="garment-lines-heading"><strong>Garments</strong><span>Prices are visible to owners and supervisors only.</span></div>{garments.map((item,index) => <div className="garment-line" key={index}>
          <label>Garment<input required maxLength={120} placeholder="e.g. Aso-oke blouse" value={item.garment_name} onChange={event => setGarments(current => current.map((row,i) => i === index ? { ...row, garment_name: event.target.value } : row))} /></label>
          <label>Description <span className="optional">Optional</span><input maxLength={1000} placeholder="Design, fabric, or instructions" value={item.description} onChange={event => setGarments(current => current.map((row,i) => i === index ? { ...row, description: event.target.value } : row))} /></label>
          <label>Qty<input required type="number" min="1" max="100" step="1" value={item.quantity} onChange={event => setGarments(current => current.map((row,i) => i === index ? { ...row, quantity: event.target.value } : row))} /></label>
          <label>Price (₦)<input required type="number" min="0" max="1000000000" step="1" placeholder="0" value={item.unit_price} onChange={event => setGarments(current => current.map((row,i) => i === index ? { ...row, unit_price: event.target.value } : row))} /></label>
          <label>Hours per garment<input required type="number" min="0.25" max="500" step="0.25" value={item.estimated_hours} onChange={event => setGarments(current => current.map((row,i) => i === index ? { ...row, estimated_hours: event.target.value } : row))} /></label>
          {garments.length > 1 && <button type="button" className="remove-field" onClick={() => setGarments(current => current.filter((_,i) => i !== index))} aria-label={`Remove garment ${index + 1}`}>×</button>}
        </div>)}<button type="button" className="text-link add-field" disabled={garments.length >= 20} onClick={() => setGarments(current => [...current, { garment_name: "", description: "", quantity: "1", unit_price: "", estimated_hours: "8" }])}>＋ Add another garment</button><div className="order-estimate"><span>{selectedVoucher ? `Subtotal ${currency.format(subtotal)} · Voucher saves ${currency.format(discount)}` : "Order total"}{isExpress ? ` · Express fee (${expressFeePercentage}%) ${currency.format(expressFee)}` : ""}</span><strong>{currency.format(estimatedTotal)}</strong></div></div>
        <div className="capacity-estimate form-wide"><div><strong>Suggested Ready Date: {suggestedReadyDate ? displayDate(suggestedReadyDate) : "Unavailable"}</strong><span>Workshop load: {queuedOrderCount} active {queuedOrderCount === 1 ? "order" : "orders"} in queue · {queuedHours.toFixed(1)} labor hours · {activeTailorCount} active {activeTailorCount === 1 ? "tailor" : "tailors"} · includes one-day buffer</span></div>{suggestedReadyDate && <button type="button" className="button button-secondary small-button" onClick={() => { setDueDate(suggestedReadyDate); setIsExpress(false); }}>Use suggested date</button>}</div>
        <label className="express-toggle form-wide"><input type="checkbox" checked={isExpress} onChange={event => { if (event.target.checked && !selectedDateIsEarly) { setFeedback("Choose a ready date earlier than the suggestion before enabling Express Order."); return; } setFeedback(""); setIsExpress(event.target.checked); }} /><span><strong>Express Order</strong><small>Add a {expressFeePercentage}% rush charge and prioritize this order.</small></span></label>
        {selectedDateIsEarly && !isExpress && <p className="capacity-warning form-wide">This date is ahead of studio capacity. Express fee will be required to continue.</p>}
        <label>Ready date<input type="date" value={dueDate} onChange={event => selectReadyDate(event.target.value)} /></label>
        <label>Fitting date<input type="date" value={fittingDate} onChange={event => setFittingDate(event.target.value)} /></label>
        <label>Fulfilment method<select value={fulfillmentMethod} onChange={event => setFulfillmentMethod(event.target.value as "pickup" | "delivery")}><option value="pickup">Customer pickup</option><option value="delivery">Delivery</option></select></label>
        {fulfillmentMethod === "pickup" ? <label>Pickup date<input type="date" value={pickupDate} onChange={event => setPickupDate(event.target.value)} /></label> : <label>Delivery date<input type="date" value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} /></label>}
        <label className="form-wide">Order notes <span className="optional">Optional</span><textarea rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={resetForm}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving || customers.length === 0}>{isSaving ? "Creating…" : "Create order"}</button></div>
      </form>}
    </section>}

    <div className="orders-list-toolbar"><div><h2>Order board</h2><span>{visibleOrders.length} {visibleOrders.length === 1 ? "order" : "orders"}</span></div><div className="order-filters"><label className="customer-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search order or customer" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search orders" /></label><select aria-label="Filter orders by production stage" value={stageFilter} onChange={event => setStageFilter(event.target.value)}><option value="all">All stages</option>{stages.map(stage => <option value={stage.value} key={stage.value}>{stage.label}</option>)}</select></div></div>

    {visibleOrders.length === 0 ? <div className="empty-customers"><div className="empty-icon">▤</div><h3>{orders.length ? "No orders match this filter" : "No orders yet"}</h3><p>{orders.length ? "Try another search or production stage." : "Create an order for one of your studio’s customers to start tracking production."}</p>{canManage && customers.length > 0 && <button className="button button-primary" onClick={() => setShowForm(true)}>＋ Create first order</button>}</div> : <div className="order-list">{visibleOrders.map(order => {
      const stage = stages.find(item => item.value === order.stage) ?? stages[0];
      const stageLabel = stage.value === "ready_for_pickup" && order.fulfillment_method === "delivery" ? "Ready for delivery" : stage.label;
      const subtotal = order.items.reduce((sum,item) => sum + item.quantity * (item.unit_price ?? 0), 0);
      const total = Math.max(0, subtotal - order.discount_amount) + order.express_fee_amount;
      const overdue = order.due_date && order.due_date < localDate() && order.stage !== "completed" && order.stage !== "cancelled";
      const stageOptions = canManage ? stages.filter(item => item.value !== "completed") : stages.filter(item => item.value === order.stage || item.value === "in_production" || item.value === "awaiting_fitting");
      return <article className="order-card" id={order.id} key={order.id}>
        <div className="order-card-header"><div><span className="order-reference">{order.order_ref}</span><h3>{order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : "Assigned customer"}</h3><span className="customer-reference">{order.customer?.customer_ref ?? "Studio order"}</span></div><span className={`order-stage-pill ${stageTone[order.stage]}`}>{stageLabel}</span>{order.is_express && <span className="express-priority-pill">Express · High priority</span>}</div>
        <div className="order-items-list">{order.items.map(item => <div className="order-item-row" key={item.id}><div><strong>{item.garment_name}</strong>{item.description && <span>{item.description}</span>}<small className="order-labor-estimate">Est. {item.estimated_hours} labor hours each</small></div><span>×{item.quantity}</span>{canManage && item.unit_price !== null && <strong>{currency.format(item.quantity * item.unit_price)}</strong>}</div>)}</div>
        <div className="order-schedule"><span><small>Due</small><strong className={overdue ? "overdue-text" : ""}>{overdue ? `Overdue · ${displayDate(order.due_date)}` : displayDate(order.due_date)}</strong></span>{order.fitting_date && <span><small>Fitting</small><strong>{displayDate(order.fitting_date)}</strong></span>}<span><small>{order.fulfillment_method === "delivery" ? "Delivery" : "Pickup"}</small><strong>{order.fulfillment_method === "delivery" ? displayDate(order.delivery_date) : displayDate(order.pickup_date)}</strong></span>{canManage && <span className="order-total"><small>{order.discount_amount ? `Total · ${currency.format(order.discount_amount)} voucher discount${order.express_fee_amount ? ` + ${currency.format(order.express_fee_amount)} express fee` : ""}` : order.express_fee_amount ? `Total · ${currency.format(order.express_fee_amount)} express fee` : "Order total"}</small><strong>{currency.format(total)}</strong></span>}</div>
        <section className="assignment-panel"><div className="assignment-heading"><strong>Production team</strong><span>{order.assignments.length ? order.assignments.map(member => member.email).join(" · ") : "Unassigned"}</span></div>{canManage && <div className="assignment-controls">{team.length ? <><select aria-label={`Choose team member for ${order.order_ref}`} value={assignmentSelections[order.id] ?? ""} onChange={event => setAssignmentSelections(current => ({ ...current, [order.id]: event.target.value }))}><option value="">Choose a supervisor or tailor</option>{team.map(member => <option key={member.user_id} value={member.user_id}>{member.email} · {member.role}</option>)}</select><button className="button button-secondary small-button" disabled={!assignmentSelections[order.id] || savingAssignment?.startsWith(`${order.id}:`)} onClick={() => { const userId = assignmentSelections[order.id]; if (userId) changeAssignment(order.id, userId, "assign"); }}>Assign</button></> : <span className="assignment-empty">Add active supervisors or tailors in Supabase before assigning work.</span>}{order.assignments.map(member => <button key={member.user_id} className="assignment-remove" disabled={savingAssignment === `${order.id}:${member.user_id}`} onClick={() => changeAssignment(order.id, member.user_id, "unassign")} aria-label={`Unassign ${member.email} from ${order.order_ref}`}>Remove {member.email} ×</button>)}</div>}</section>
        {order.measurement_session_id && <details className="order-measurements"><summary>⌁ View linked measurements ({order.measurements.length})</summary><div className="measurement-chips">{order.measurements.map(item => <span key={item.id}><strong>{item.field_name}</strong> {item.value}{item.unit}</span>)}</div></details>}
        {order.notes && <p className="order-notes">{order.notes}</p>}

        {order.activity.length > 0 && <details className="order-activity-timeline"><summary>Activity history ({order.activity.length})</summary><ol>{order.activity.map((item, index) => <li key={item.created_at + "-" + index}><strong>{activityTitle(item)}</strong>{activityChanges(item).map(change => <small className="activity-change" key={change}>{change}</small>)}<span>{item.actor_label} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</time></span>{item.note && <p>{item.note}</p>}</li>)}</ol></details>}
        <div className="order-card-actions">{order.fulfilled_at ? <><span className="fulfillment-confirmed">✓ {order.fulfillment_method === "delivery" ? "Delivered" : "Collected"} · {new Date(order.fulfilled_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>{canManage && <button className="button button-secondary small-button" disabled={voucherLinkingId === order.id} onClick={() => void sendThankYouVoucher(order)}>{voucherLinkingId === order.id ? "Preparing…" : "Thank you & voucher · WhatsApp"}</button>}</> : <><label className="stage-select-label">Production stage<select aria-label={`Change stage for ${order.order_ref}`} value={order.stage} disabled={savingOrderId === order.id || order.stage === "cancelled"} onChange={event => changeStage(order.id, event.target.value as OrderStage)}>{stageOptions.map(item => <option value={item.value} key={item.value}>{item.value === "ready_for_pickup" && order.fulfillment_method === "delivery" ? "Ready for delivery" : item.label}</option>)}</select></label>{canManage && order.stage === "ready_for_pickup" && <a className="button button-primary small-button whatsapp-update-button" href={`/api/orders/${encodeURIComponent(order.id)}/whatsapp-update`} target="_blank" rel="noopener noreferrer">Send WhatsApp Update</a>}</>}{canManage && !order.fulfilled_at && order.stage !== "cancelled" && <button className="button button-secondary small-button" onClick={() => beginScheduleEdit(order)}>Edit dates</button>}{canManage && order.stage === "ready_for_pickup" && !order.fulfilled_at && <button className="button button-secondary fulfill-button" disabled={savingOrderId === order.id} onClick={() => completeFulfillment(order)}>{order.fulfillment_method === "delivery" ? "Mark delivered" : "Mark collected"}</button>}</div>
{canManage && scheduleEditingId === order.id && scheduleDraft && <form className="schedule-editor" onSubmit={event => saveSchedule(event, order.id)}>
  <label>Promised completion<input type="date" value={scheduleDraft.dueDate} onChange={event => setScheduleDraft(current => current ? { ...current, dueDate: event.target.value } : current)} /></label>
  <label>Fitting date<input type="date" value={scheduleDraft.fittingDate} onChange={event => setScheduleDraft(current => current ? { ...current, fittingDate: event.target.value } : current)} /></label>
  <label>Fulfilment method<select value={scheduleDraft.fulfillmentMethod} onChange={event => setScheduleDraft(current => current ? { ...current, fulfillmentMethod: event.target.value as "pickup" | "delivery" } : current)}><option value="pickup">Customer pickup</option><option value="delivery">Delivery</option></select></label>
  {scheduleDraft.fulfillmentMethod === "pickup" ? <label>Pickup date<input type="date" value={scheduleDraft.pickupDate} onChange={event => setScheduleDraft(current => current ? { ...current, pickupDate: event.target.value } : current)} /></label> : <label>Delivery date<input type="date" value={scheduleDraft.deliveryDate} onChange={event => setScheduleDraft(current => current ? { ...current, deliveryDate: event.target.value } : current)} /></label>}
  <div className="form-actions schedule-actions"><button type="button" className="button button-secondary" onClick={() => { setScheduleEditingId(null); setScheduleDraft(null); }}>Cancel</button><button type="submit" className="button button-primary" disabled={savingScheduleId === order.id}>{savingScheduleId === order.id ? "Saving…" : "Save schedule"}</button></div>
</form>}
      </article>;
    })}</div>}
  </div>;
}






