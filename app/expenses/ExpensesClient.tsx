"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Category = "fabric_materials" | "rent_utilities" | "staff_wages" | "transport" | "marketing" | "other";
type Expense = { id: string; expense_date: string; amount: number; category: Category; note: string | null; order_id: string | null; order_label: string | null; receipt_path: string | null; receipt_url: string | null; recorded_by_label: string; created_at: string; updated_at: string };
type OrderOption = { id: string; label: string };
type Activity = { id: string; expense_id: string; event_type: "created" | "updated"; before_state: Record<string, unknown> | null; after_state: Record<string, unknown>; actor_label: string; created_at: string };
const categories: { value: Category; label: string }[] = [
  { value: "fabric_materials", label: "Fabric and materials" }, { value: "rent_utilities", label: "Rent and utilities" },
  { value: "staff_wages", label: "Staff wages" }, { value: "transport", label: "Transport" },
  { value: "marketing", label: "Marketing" }, { value: "other", label: "Other" },
];
const categoryLabels = Object.fromEntries(categories.map(item => [item.value, item.label])) as Record<Category, string>;
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
function localDate() { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }
function displayDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }); }
function monthKey(value: string) { return value.slice(0, 7); }
function auditSummary(activity: Activity, orders: OrderOption[]) {
  const after = activity.after_state;
  const before = activity.before_state;
  if (!before) return `Initial ${currency.format(Number(after.amount ?? 0))} · ${categoryLabels[after.category as Category] ?? "Expense"}`;
  const changes: string[] = [];
  if (Number(before.amount) !== Number(after.amount)) changes.push(`Amount ${currency.format(Number(before.amount))} → ${currency.format(Number(after.amount))}`);
  if (before.category !== after.category) changes.push(`Category ${categoryLabels[before.category as Category] ?? before.category} → ${categoryLabels[after.category as Category] ?? after.category}`);
  if (before.expense_date !== after.expense_date) changes.push(`Date ${String(before.expense_date)} → ${String(after.expense_date)}`);
  if (before.order_id !== after.order_id) {
    const label = (id: unknown) => id ? orders.find(order => order.id === id)?.label ?? "Order" : "Studio cost";
    changes.push(`Order ${label(before.order_id)} → ${label(after.order_id)}`);
  }
  if (before.note !== after.note) changes.push("Note changed");
  if (before.receipt_path !== after.receipt_path) changes.push("Receipt photo changed");
  return changes.join(" · ") || "No expense details changed";
}

export default function ExpensesClient({ businessId, expenses, orders, activities, dataError }: { businessId: string; expenses: Expense[]; orders: OrderOption[]; activities: Activity[]; dataError: boolean }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [expenseDate, setExpenseDate] = useState(localDate);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("fabric_materials");
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [query, setQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const thisMonth = localDate().slice(0, 7);
  const monthExpenses = expenses.filter(expense => monthKey(expense.expense_date) === thisMonth).reduce((sum, expense) => sum + expense.amount, 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const visibleExpenses = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return expenses;
    return expenses.filter(expense => `${expense.expense_date} ${categoryLabels[expense.category]} ${expense.note ?? ""} ${expense.order_label ?? ""} ${expense.recorded_by_label}`.toLocaleLowerCase().includes(needle));
  }, [expenses, query]);

  function resetForm() {
    setShowForm(false); setEditing(null); setExpenseDate(localDate()); setAmount(""); setCategory("fabric_materials");
    setNote(""); setOrderId(""); setFile(null); setRemoveReceipt(false); setFeedback("");
  }
  function startEdit(expense: Expense) {
    setEditing(expense); setShowForm(true); setExpenseDate(expense.expense_date.slice(0, 10)); setAmount(String(expense.amount));
    setCategory(expense.category); setNote(expense.note ?? ""); setOrderId(expense.order_id ?? ""); setFile(null); setRemoveReceipt(false); setFeedback("");
  }
  async function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setFeedback("");
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 100000000000) { setFeedback("Enter an expense amount greater than zero."); return; }
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
      setFeedback("Receipt photos must be JPG, PNG, or WebP and no larger than 5 MB."); return;
    }
    setIsSaving(true);
    const supabase = createClient();
    const expenseId = editing?.id ?? crypto.randomUUID();
    let newPath = editing?.receipt_path ?? null;
    let uploadedPath: string | null = null;
    if (file) {
      const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
      uploadedPath = `${businessId}/${expenseId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from("expense-receipts").upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (error) { setFeedback("We could not upload the receipt photo. Try a smaller JPG, PNG, or WebP image."); setIsSaving(false); return; }
      newPath = uploadedPath;
    } else if (removeReceipt) newPath = null;

    const values = { expense_date: expenseDate, amount: numericAmount, category, note: note.trim() || null, order_id: orderId || null, receipt_path: newPath };
    const result = editing
      ? await supabase.from("studio_expenses").update(values).eq("id", editing.id).eq("business_id", businessId)
      : await supabase.from("studio_expenses").insert({ id: expenseId, business_id: businessId, ...values });
    if (result.error) {
      if (uploadedPath) await supabase.storage.from("expense-receipts").remove([uploadedPath]);
      setFeedback("We could not save this expense. Refresh and try again."); setIsSaving(false); return;
    }
    const oldPath = editing?.receipt_path;
    if (oldPath && oldPath !== newPath) await supabase.storage.from("expense-receipts").remove([oldPath]);
    setIsSaving(false); resetForm(); router.refresh();
  }

  return <div className="expenses-workspace">
    {dataError && <div className="notice notice-error" role="status"><span className="notice-dot" /><span><strong>Some expense data could not be loaded.</strong> Check that the expense migration is applied, then refresh.</span></div>}
    <section className="expense-summary">
      <article><span>Expenses this month</span><strong>{currency.format(monthExpenses)}</strong><small>Based on expense date</small></article>
      <article><span>All recorded expenses</span><strong>{currency.format(totalExpenses)}</strong><small>{expenses.length} ledger entries</small></article>
      <button className="button button-primary" onClick={() => { setEditing(null); setShowForm(value => !value); setFeedback(""); }}>＋ Record expense</button>
    </section>
    <p className="expense-policy-note">Tag a cost to an order to include it in that order's estimated gross profit. Expenses without an order are treated as studio operating costs. Updates are retained in the audit history.</p>
    {feedback && !showForm && <p className="customer-feedback" role="status">{feedback}</p>}
    {showForm && <section className="payment-form-card expense-form-card">
      <div className="customer-form-heading"><div><p className="eyebrow">STUDIO SPENDING</p><h2>{editing ? "Edit expense" : "Record an expense"}</h2></div><button type="button" className="close-button" onClick={resetForm} aria-label="Close expense form">×</button></div>
      <form className="payment-form" onSubmit={saveExpense}>
        <label>Expense date<input type="date" required value={expenseDate} onChange={event => setExpenseDate(event.target.value)} /></label>
        <label>Amount (₦)<input type="number" required min="0.01" max="100000000000" step="0.01" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label>Category<select value={category} onChange={event => setCategory(event.target.value as Category)}>{categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>Link to order <span className="optional">Optional</span><select value={orderId} onChange={event => setOrderId(event.target.value)}><option value="">Studio operating cost</option>{orders.map(order => <option value={order.id} key={order.id}>{order.label}</option>)}</select></label>
        <label className="form-wide">Note <span className="optional">Optional</span><textarea rows={2} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder="What was this expense for?" /></label>
        <div className="expense-receipt-field form-wide"><label htmlFor="expense-receipt">Receipt photo <span className="optional">Optional · JPG, PNG or WebP · up to 5 MB</span></label><input id="expense-receipt" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { setFile(event.target.files?.[0] ?? null); setRemoveReceipt(false); }} />{file && <small>Selected: {file.name}</small>}{editing?.receipt_url && !removeReceipt && !file && <a className="expense-receipt-link" href={editing.receipt_url} target="_blank" rel="noreferrer">View current receipt</a>}{editing?.receipt_path && <label className="expense-remove-receipt"><input type="checkbox" checked={removeReceipt} onChange={event => setRemoveReceipt(event.target.checked)} /> Remove current receipt</label>}</div>
        {feedback && <p className="auth-error form-wide" role="alert">{feedback}</p>}
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={resetForm}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? "Saving…" : editing ? "Save changes" : "Record expense"}</button></div>
      </form>
    </section>}
    <section className="expense-ledger panel">
      <header className="panel-heading"><div><h2>Expense ledger</h2><p>Money spent by the studio, with order-level cost attribution.</p></div><label className="customer-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search expenses" placeholder="Search category, order, note" value={query} onChange={event => setQuery(event.target.value)} /></label></header>
      {visibleExpenses.length ? <div className="expense-list">{visibleExpenses.map(expense => {
        const changes = activities.filter(activity => activity.expense_id === expense.id);
        return <article className="expense-row" key={expense.id}>
          <div className="expense-main"><time>{displayDate(expense.expense_date)}</time><span className="expense-category-pill">{categoryLabels[expense.category]}</span><strong>{currency.format(expense.amount)}</strong></div>
          <div className="expense-details"><span>{expense.note || "No note"}</span><small>{expense.order_label ? `Order · ${expense.order_label}` : "Studio operating cost"} · recorded by {expense.recorded_by_label}</small></div>
          <div className="expense-row-actions">{expense.receipt_url && <a className="expense-receipt-link" href={expense.receipt_url} target="_blank" rel="noreferrer">Receipt photo</a>}<button className="text-link" onClick={() => startEdit(expense)}>Edit</button></div>
          <details className="expense-history"><summary>Audit history · {changes.length}</summary><div>{changes.map(change => <p key={change.id}><strong>{change.event_type === "created" ? "Recorded" : "Updated"}</strong> by {change.actor_label} · {displayDate(change.created_at)}<br /><span>{auditSummary(change, orders)}</span></p>)}</div></details>
        </article>;
      })}</div> : <p className="dashboard-empty expense-empty">{expenses.length ? "No expenses match that search." : "No expenses recorded yet. Record a studio cost to start tracking cash out."}</p>}
    </section>
  </div>;
}
