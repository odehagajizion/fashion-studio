"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type OrderChoice = { id: string; order_ref: string; customer_name: string; stage: string; total: number; received: number; balance: number };
type PaymentEvent = { id: string; kind: "payment" | "adjustment"; payment_id: string | null; order_id: string; order_ref: string; customer_name: string; amount: number; method: string | null; reference: string | null; note: string | null; created_at: string; remaining_adjustable: number };
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const methodLabels: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", other: "Other" };
function localDate() { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; }
function displayDate(value: string) { return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }

export default function PaymentsClient({ orders, receivableOrders, history, totalReceived, outstanding }: {
  orders: OrderChoice[]; receivableOrders: OrderChoice[]; history: PaymentEvent[]; totalReceived: number; outstanding: number;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [receivedDate, setReceivedDate] = useState(localDate);
  const [adjusting, setAdjusting] = useState<PaymentEvent | null>(null);
  const [adjustmentType, setAdjustmentType] = useState<"refund" | "reversal">("refund");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const selectedOrder = receivableOrders.find(order => order.id === orderId);
  const visibleHistory = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return history;
    return history.filter(event => `${event.order_ref} ${event.customer_name} ${event.reference ?? ""} ${event.note ?? ""} ${event.method ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [history, query]);

  function closePaymentForm() {
    setShowForm(false); setOrderId(""); setAmount(""); setMethod("bank_transfer"); setReference(""); setNote(""); setReceivedDate(localDate()); setFeedback("");
  }

  async function recordPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback("");
    const numericAmount = Number(amount);
    if (!orderId || !Number.isFinite(numericAmount) || numericAmount <= 0 || !selectedOrder || numericAmount > selectedOrder.balance) {
      setFeedback("Choose an order and enter an amount up to its current outstanding balance."); return;
    }
    setIsSaving(true);
    const { error } = await createClient().rpc("record_manual_payment", {
      p_order_id: orderId, p_amount: numericAmount, p_method: method,
      p_reference: reference.trim() || null, p_note: note.trim() || null,
      p_received_at: new Date(`${receivedDate}T12:00:00`).toISOString(),
    });
    if (error) { setFeedback("We couldn’t record the receipt. Refresh to get the latest balance and try again."); setIsSaving(false); return; }
    setIsSaving(false); closePaymentForm(); router.refresh();
  }

  async function recordAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback("");
    if (!adjusting || !adjusting.payment_id) return;
    const numericAmount = Number(adjustmentAmount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > adjusting.remaining_adjustable || !reason.trim()) {
      setFeedback("Enter a valid amount up to the unadjusted receipt, and include a reason."); return;
    }
    setIsSaving(true);
    const { error } = await createClient().rpc("record_payment_adjustment", {
      p_payment_id: adjusting.payment_id, p_adjustment_type: adjustmentType, p_amount: numericAmount, p_reason: reason.trim(),
    });
    if (error) { setFeedback("We couldn’t save the adjustment. Refresh and confirm the remaining receipt amount."); setIsSaving(false); return; }
    setIsSaving(false); setAdjusting(null); setAdjustmentAmount(""); setReason(""); router.refresh();
  }

  return <div className="payments-workspace">
    <div className="payment-summary">
      <article><span>Net received</span><strong>{currency.format(totalReceived)}</strong><small>Confirmed receipts less refunds and reversals</small></article>
      <article><span>Still owed</span><strong className={outstanding > 0 ? "owed-value" : ""}>{currency.format(outstanding)}</strong><small>Across non-cancelled orders</small></article>
      <article><span>Payment activity</span><strong>{history.length}</strong><small>Receipts, refunds, and reversals</small></article>
      <button className="button button-primary" disabled={receivableOrders.length === 0} onClick={() => { setFeedback(""); setShowForm(value => !value); }}>＋ Record payment</button>
    </div>
    <div className="payment-policy-note">Record money here only after it has been received. Receipts and adjustments are append-only audit entries.</div>
    {feedback && <p className="customer-feedback" role="status">{feedback}</p>}

    {showForm && <section className="payment-form-card">
      <div className="customer-form-heading"><div><p className="eyebrow">CONFIRMED RECEIPT</p><h2>Record a payment</h2></div><button type="button" className="close-button" onClick={closePaymentForm} aria-label="Close payment form">×</button></div>
      {receivableOrders.length === 0 ? <p className="payment-empty-note">There are no non-cancelled orders with an outstanding balance.</p> : <form className="payment-form" onSubmit={recordPayment}>
        <label className="form-wide">Order<select required value={orderId} onChange={event => { setOrderId(event.target.value); setAmount(""); }}><option value="">Choose an order</option>{receivableOrders.map(order => <option key={order.id} value={order.id}>{order.order_ref} · {order.customer_name} · Owed {currency.format(order.balance)}</option>)}</select></label>
        {selectedOrder && <div className="selected-order-balance form-wide"><span>Current balance</span><strong>{currency.format(selectedOrder.balance)}</strong></div>}
        <label>Amount received (₦)<input type="number" required min="0.01" step="0.01" max={selectedOrder?.balance ?? undefined} placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Received on<input type="date" required value={receivedDate} onChange={event => setReceivedDate(event.target.value)} /></label>
        <label>Payment method<select value={method} onChange={event => setMethod(event.target.value)}><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="other">Other</option></select></label>
        <label>Reference <span className="optional">Optional</span><input maxLength={120} value={reference} onChange={event => setReference(event.target.value)} placeholder="Transfer or receipt reference" /></label>
        <label className="form-wide">Note <span className="optional">Optional</span><textarea rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={closePaymentForm}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? "Saving…" : "Record confirmed payment"}</button></div>
      </form>}
    </section>}

    {adjusting && <section className="payment-form-card adjustment-card">
      <div className="customer-form-heading"><div><p className="eyebrow">PAYMENT CORRECTION</p><h2>{adjusting.order_ref} · {adjusting.customer_name}</h2></div><button type="button" className="close-button" onClick={() => setAdjusting(null)} aria-label="Close adjustment form">×</button></div>
      <p className="payment-empty-note">Original receipt: {currency.format(adjusting.amount)} · Remaining amount available to adjust: {currency.format(adjusting.remaining_adjustable)}</p>
      <form className="payment-form" onSubmit={recordAdjustment}>
        <label>Adjustment type<select value={adjustmentType} onChange={event => setAdjustmentType(event.target.value as "refund" | "reversal")}><option value="refund">Refund</option><option value="reversal">Reversal</option></select></label>
        <label>Amount (₦)<input required type="number" min="0.01" step="0.01" max={adjusting.remaining_adjustable} value={adjustmentAmount} onChange={event => setAdjustmentAmount(event.target.value)} /></label>
        <label className="form-wide">Reason<input required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={() => setAdjusting(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? "Saving…" : "Record adjustment"}</button></div>
      </form>
    </section>}

    <section className="payment-balances panel">
      <header className="panel-heading"><div><h2>Order balances</h2><p>Calculated from garment prices, confirmed payments, and adjustments.</p></div><Link className="text-link" href="/orders">Orders →</Link></header>
      {orders.length === 0 ? <p className="payment-empty-note">Orders will appear here after you create them.</p> : <div className="balance-table-wrap"><table className="balance-table"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Total</th><th>Received</th><th>Still owed</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><strong>{order.order_ref}</strong></td><td>{order.customer_name}</td><td><span className={`balance-stage ${order.stage}`}>{order.stage.replaceAll("_", " ")}</span></td><td>{currency.format(order.total)}</td><td>{currency.format(order.received)}</td><td className={order.balance > 0 ? "balance-owed" : "balance-clear"}>{currency.format(order.balance)}</td></tr>)}</tbody></table></div>}
    </section>

    <section className="payment-history panel">
      <header className="panel-heading"><div><h2>Payment history</h2><p>Receipts and corrections stay visible in the audit trail.</p></div><label className="customer-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search payment history" placeholder="Search order, customer, reference" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
      {visibleHistory.length === 0 ? <div className="payment-empty-state"><h3>No payment activity yet</h3><p>Confirmed receipts and any later adjustments will be listed here.</p></div> : <div className="payment-history-list">{visibleHistory.map(event => <article className="payment-history-row" key={`${event.kind}-${event.id}`}>
        <div className={`payment-event-icon ${event.kind}`}>{event.kind === "payment" ? "₦" : "↺"}</div>
        <div className="payment-event-main"><strong>{event.order_ref} · {event.customer_name}</strong><span>{event.kind === "payment" ? `${methodLabels[event.method ?? "other"] ?? event.method} receipt${event.reference ? ` · ${event.reference}` : ""}` : `${event.method === "refund" ? "Refund" : "Reversal"} · ${event.note}`}</span><small>{displayDate(event.created_at)}</small></div>
        <strong className={`payment-event-amount ${event.kind === "adjustment" ? "negative" : "positive"}`}>{event.kind === "adjustment" ? "−" : "+"}{currency.format(event.amount)}</strong>
        {event.kind === "payment" && event.remaining_adjustable > 0 && <button className="text-link adjust-link" onClick={() => { setAdjusting(event); setAdjustmentType("refund"); setAdjustmentAmount(""); setReason(""); setFeedback(""); }}>Adjust</button>}
      </article>)}</div>}
    </section>
  </div>;
}
