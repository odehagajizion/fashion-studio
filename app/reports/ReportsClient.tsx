"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type ReportOrder = { id: string; customer_id: string; order_ref: string; customer_name: string; stage: string; created_at: string; due_date: string | null; fulfilled_at: string | null; order_total: number | null; received: number | null; balance: number | null };
type Transaction = { id: string; order_id: string; order_ref: string; customer_name: string; type: "payment" | "adjustment"; label: string; amount: number; date: string; reason: string };
type ReportExpense = { id: string; expense_date: string; amount: number; category: string; order_id: string | null };
type Bucket = { key: string; label: string; orderValue: number; netReceived: number; expenses: number };
type CustomerTotal = { id: string; name: string; count: number; value: number };
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const stageLabels: Record<string, string> = { not_started: "Not started", in_production: "In production", awaiting_fitting: "Awaiting fitting", ready_for_pickup: "Ready for pickup", completed: "Completed", cancelled: "Cancelled" };
const methodLabels: Record<string, string> = { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", other: "Other", refund: "Refund", reversal: "Reversal" };
function businessDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function displayDate(value: string) { return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }); }
function periodStart(days: number, today: string) { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - days + 1); return date.toISOString().slice(0, 10); }
function csvCell(value: string | number) {
  let safe = String(value);
  if (/^[=+\-@]/.test(safe)) safe = `\t${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

export default function ReportsClient({ orders, transactions, expenses, isOwner, dataError }: { orders: ReportOrder[]; transactions: Transaction[]; expenses: ReportExpense[]; isOwner: boolean; dataError: boolean }) {
  const [days, setDays] = useState<30 | 90 | 365>(30);
  const today = businessDate(new Date());
  const startDate = periodStart(days, today);
  const ordersInRange = useMemo(() => orders.filter(order => businessDate(order.created_at) >= startDate && businessDate(order.created_at) <= today), [orders, startDate, today]);
  const transactionsInRange = useMemo(() => transactions.filter(event => businessDate(event.date) >= startDate && businessDate(event.date) <= today), [transactions, startDate, today]);
  const expensesInRange = useMemo(() => expenses.filter(expense => expense.expense_date >= startDate && expense.expense_date <= today), [expenses, startDate, today]);
  const orderValue = ordersInRange.reduce((sum, order) => sum + (order.order_total ?? 0), 0);
  const grossReceived = transactionsInRange.filter(event => event.type === "payment").reduce((sum, event) => sum + event.amount, 0);
  const adjustments = transactionsInRange.filter(event => event.type === "adjustment").reduce((sum, event) => sum + event.amount, 0);
  const netReceived = grossReceived - adjustments;
  const expenseTotal = expensesInRange.reduce((sum, expense) => sum + expense.amount, 0);
  const cashNet = netReceived - expenseTotal;
  const outstanding = isOwner ? orders.reduce((sum, order) => sum + (order.balance ?? 0), 0) : 0;
  const activeOrders = orders.filter(order => order.stage !== "completed" && order.stage !== "cancelled");
  const overdue = activeOrders.filter(order => order.due_date && order.due_date < today);
  const completedInRange = orders.filter(order => order.stage === "completed" && order.fulfilled_at && businessDate(order.fulfilled_at) >= startDate && businessDate(order.fulfilled_at) <= today);
  const completedWithDeadline = completedInRange.filter(order => order.due_date);
  const costByOrder = new Map<string, number>();
  expenses.forEach(expense => { if (expense.order_id) costByOrder.set(expense.order_id, (costByOrder.get(expense.order_id) ?? 0) + expense.amount); });
  const profitOrders = ordersInRange.map(order => ({ ...order, directCost: costByOrder.get(order.id) ?? 0, grossProfit: (order.order_total ?? 0) - (costByOrder.get(order.id) ?? 0) }));
  const completedGrossProfit = completedInRange.reduce((sum, order) => sum + (order.order_total ?? 0) - (costByOrder.get(order.id) ?? 0), 0);
  const unlinkedOperatingExpenses = expensesInRange.filter(expense => !expense.order_id).reduce((sum, expense) => sum + expense.amount, 0);
  const operatingProfitEstimate = completedGrossProfit - unlinkedOperatingExpenses;
  const onTimeCount = completedWithDeadline.filter(order => order.due_date && order.fulfilled_at && businessDate(order.fulfilled_at) <= order.due_date).length;
  const onTimeRate = completedWithDeadline.length ? Math.round(onTimeCount / completedWithDeadline.length * 100) : null;
  const byStage = ["not_started", "in_production", "awaiting_fitting", "ready_for_pickup"].map(stage => ({ stage, count: activeOrders.filter(order => order.stage === stage).length }));
  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>();
    const cursor = new Date(`${startDate}T12:00:00Z`);
    cursor.setUTCDate(1);
    const end = new Date(`${today}T12:00:00Z`);
    end.setUTCDate(1);
    while (cursor <= end) {
      const key = cursor.toISOString().slice(0, 7);
      map.set(key, { key, label: new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(cursor), orderValue: 0, netReceived: 0, expenses: 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    ordersInRange.forEach(order => { const bucket = map.get(businessDate(order.created_at).slice(0, 7)); if (bucket) bucket.orderValue += order.order_total ?? 0; });
    transactionsInRange.forEach(event => { const bucket = map.get(businessDate(event.date).slice(0, 7)); if (bucket) bucket.netReceived += event.type === "payment" ? event.amount : -event.amount; });
    expensesInRange.forEach(expense => { const bucket = map.get(expense.expense_date.slice(0, 7)); if (bucket) bucket.expenses += expense.amount; });
    return [...map.values()];
  }, [startDate, today, ordersInRange, transactionsInRange, expensesInRange]);
  const scale = Math.max(1, ...buckets.map(bucket => Math.max(bucket.orderValue, bucket.netReceived, bucket.expenses)));
  const topCustomers = useMemo(() => {
    const map = new Map<string, CustomerTotal>();
    ordersInRange.forEach(order => {
      const row = map.get(order.customer_id) ?? { id: order.customer_id, name: order.customer_name, count: 0, value: 0 };
      row.count += 1; row.value += order.order_total ?? 0; map.set(order.customer_id, row);
    });
    return [...map.values()].sort((a, b) => b.value - a.value).slice(0, 5);
  }, [ordersInRange]);

  function downloadCsv() {
    const lines: (string | number)[][] = [["Record", "Date", "Order", "Customer", "Status or method", "Order value (NGN)", "Net received (NGN)", "Expense (NGN)", "Balance (NGN)", "Profit estimate (NGN)"]];
    ordersInRange.forEach(order => lines.push(["Order", businessDate(order.created_at), order.order_ref, order.customer_name, stageLabels[order.stage] ?? order.stage, order.order_total ?? "", order.received ?? "", "", order.balance ?? "", ""]));
    if (isOwner) {
      transactionsInRange.forEach(event => lines.push([event.type === "payment" ? "Payment" : "Adjustment", businessDate(event.date), event.order_ref, event.customer_name, methodLabels[event.label] ?? event.label, "", event.type === "payment" ? event.amount : -event.amount, "", "", ""]));
      expensesInRange.forEach(expense => lines.push(["Expense", expense.expense_date, expense.order_id ?? "Studio", "", expense.category, "", "", expense.amount, "", ""]));
      profitOrders.forEach(order => lines.push(["Order profit estimate", businessDate(order.created_at), order.order_ref, order.customer_name, stageLabels[order.stage] ?? order.stage, order.order_total ?? 0, order.received ?? 0, order.directCost, order.balance ?? "", order.grossProfit]));
    }
    const csv = lines.map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `mvendywendy-report-${startDate}-${today}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="reports-workspace">
    {dataError && <div className="notice notice-error" role="status"><span className="notice-dot" /><span><strong>Some report data could not be loaded.</strong> Check the Supabase connection and migration status.</span></div>}
    <div className="reports-toolbar"><div><p className="eyebrow">REPORTING PERIOD</p><strong>{displayDate(startDate)} – {displayDate(today)}</strong></div><div className="reports-actions"><label>Period<select value={days} onChange={event => setDays(Number(event.target.value) as 30 | 90 | 365)}><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select></label><button className="button button-secondary" onClick={downloadCsv}>↓ Export CSV</button></div></div>
    {!isOwner && <p className="report-access-note">Financial reports are available to the owner. This view shows operational performance only.</p>}
    <section className={`report-metrics ${isOwner ? "owner-report-metrics" : "operational-report-metrics"}`}>
      <article><span>Orders created</span><strong>{ordersInRange.length}</strong><small>In the selected period</small></article>
      <article><span>Active orders</span><strong>{activeOrders.length}</strong><small>{overdue.length} overdue</small></article>
      {isOwner && <><article><span>Order value</span><strong>{currency.format(orderValue)}</strong><small>Orders created in this period</small></article><article><span>Net received</span><strong>{currency.format(netReceived)}</strong><small>{currency.format(adjustments)} refunds or reversals</small></article><article><span>Expenses</span><strong className="report-owed">{currency.format(expenseTotal)}</strong><small>Recorded in this period</small></article><article><span>Cash net</span><strong className={cashNet < 0 ? "report-owed" : ""}>{currency.format(cashNet)}</strong><small>Net received minus expenses</small></article><article><span>Still owed</span><strong className="report-owed">{currency.format(outstanding)}</strong><small>Across active orders today</small></article><article><span>Gross profit estimate</span><strong className={completedGrossProfit < 0 ? "report-owed" : ""}>{currency.format(completedGrossProfit)}</strong><small>Completed order value less tagged costs</small></article><article><span>Operating profit estimate</span><strong className={operatingProfitEstimate < 0 ? "report-owed" : ""}>{currency.format(operatingProfitEstimate)}</strong><small>Gross profit less unlinked expenses</small></article></>}
      <article><span>On-time completion</span><strong>{onTimeRate === null ? "—" : `${onTimeRate}%`}</strong><small>{completedWithDeadline.length ? `${onTimeCount} of ${completedWithDeadline.length} completed orders` : "No completed orders with due dates"}</small></article>
    </section>

    <section className="report-content-grid">
      {isOwner && <article className="report-panel panel"><header className="panel-heading"><div><h2>Order value, money received, and expenses</h2><p>Payments and expenses are cash movements; order value is shown separately.</p></div></header><div className="report-chart-legend"><span><i className="order-value-key" /> Order value</span><span><i className="received-key" /> Net received</span><span><i className="expense-key" /> Expenses</span></div><div className="report-chart">{buckets.map(bucket => <div className="report-chart-column" key={bucket.key}><div className="report-bars"><span className="report-bar order-value-bar" style={{ height: `${bucket.orderValue ? Math.max(4, bucket.orderValue / scale * 160) : 0}px` }} title={`Order value ${currency.format(bucket.orderValue)}`} /><span className="report-bar received-bar" style={{ height: `${bucket.netReceived ? Math.max(4, Math.max(0, bucket.netReceived) / scale * 160) : 0}px` }} title={`Net received ${currency.format(bucket.netReceived)}`} /><span className="report-bar expense-bar" style={{ height: `${bucket.expenses ? Math.max(4, bucket.expenses / scale * 160) : 0}px` }} title={`Expenses ${currency.format(bucket.expenses)}`} /></div><small>{bucket.label}</small></div>)}</div>{buckets.length === 0 && <p className="dashboard-empty">No activity in this period.</p>}<div className="cashflow-table-wrap"><table className="report-table cashflow-table"><thead><tr><th>Month</th><th>Received</th><th>Expenses</th><th>Cash net</th></tr></thead><tbody>{buckets.map(bucket => <tr key={`cash-${bucket.key}`}><td>{bucket.label}</td><td>{currency.format(bucket.netReceived)}</td><td>{currency.format(bucket.expenses)}</td><td className={bucket.netReceived - bucket.expenses < 0 ? "report-owed" : ""}>{currency.format(bucket.netReceived - bucket.expenses)}</td></tr>)}</tbody></table></div></article>}
      <article className="report-panel panel"><header className="panel-heading"><div><h2>Production stages</h2><p>Current active workload</p></div></header>{activeOrders.length ? <div className="report-stage-list">{byStage.map(item => <div className="report-stage-row" key={item.stage}><span>{stageLabels[item.stage]}</span><div className="progress-track"><i style={{ width: `${activeOrders.length ? item.count / activeOrders.length * 100 : 0}%` }} /></div><strong>{item.count}</strong></div>)}</div> : <p className="dashboard-empty">No active orders.</p>}<div className="report-operational-footer"><span>Completed in period</span><strong>{completedInRange.length}</strong><span>Past promised date</span><strong>{overdue.length}</strong></div></article>
    </section>

    <section className="report-content-grid report-tables-grid">
      <article className="report-panel panel"><header className="panel-heading"><div><h2>Orders created in period</h2><p>{ordersInRange.length} total</p></div></header>{ordersInRange.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Order</th><th>Customer</th><th>Created</th><th>Status</th>{isOwner && <><th>Value</th><th>Owed</th></>}</tr></thead><tbody>{ordersInRange.slice(0, 12).map(order => <tr key={order.id}><td><Link href={`/orders#${order.id}`}>{order.order_ref}</Link></td><td>{order.customer_name}</td><td>{displayDate(order.created_at)}</td><td><span className={`balance-stage ${order.stage}`}>{stageLabels[order.stage] ?? order.stage}</span></td>{isOwner && <><td>{currency.format(order.order_total ?? 0)}</td><td className={(order.balance ?? 0) > 0 ? "report-owed" : ""}>{currency.format(order.balance ?? 0)}</td></>}</tr>)}</tbody></table></div> : <p className="dashboard-empty">No orders were created during this period.</p>}</article>
      {isOwner && <article className="report-panel panel"><header className="panel-heading"><div><h2>Estimated gross profit by order</h2><p>Order value less expenses linked to that order. Estimates use all tagged costs recorded to date.</p></div></header>{profitOrders.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Order</th><th>Customer</th><th>Order value</th><th>Tagged costs</th><th>Gross profit estimate</th></tr></thead><tbody>{profitOrders.slice(0, 20).map(order => <tr key={`profit-${order.id}`}><td><Link href={`/orders#${order.id}`}>{order.order_ref}</Link></td><td>{order.customer_name}</td><td>{currency.format(order.order_total ?? 0)}</td><td>{currency.format(order.directCost)}</td><td className={order.grossProfit < 0 ? "report-owed" : ""}>{currency.format(order.grossProfit)}</td></tr>)}</tbody></table></div> : <p className="dashboard-empty">Order profit estimates appear when orders and linked costs are recorded.</p>}</article>}
      {isOwner && <article className="report-panel panel"><header className="panel-heading"><div><h2>Top customers</h2><p>By value of orders created in period</p></div></header>{topCustomers.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Customer</th><th>Orders</th><th>Order value</th></tr></thead><tbody>{topCustomers.map(customer => <tr key={customer.id}><td>{customer.name}</td><td>{customer.count}</td><td>{currency.format(customer.value)}</td></tr>)}</tbody></table></div> : <p className="dashboard-empty">Customer totals appear as orders are recorded.</p>}<header className="panel-heading report-transaction-heading"><div><h2>Recent payment activity</h2><p>Receipts and adjustments in selected period</p></div></header>{transactionsInRange.length ? <div className="report-transaction-list">{transactionsInRange.slice(0, 6).map(event => <div key={`${event.type}-${event.id}`}><span className={event.type === "adjustment" ? "report-owed" : ""}>{event.type === "payment" ? "+" : "−"}{currency.format(event.amount)}</span><small>{event.order_ref} · {event.customer_name} · {methodLabels[event.label] ?? event.label} · {displayDate(event.date)}</small></div>)}</div> : <p className="dashboard-empty report-no-transactions">No payment activity in this period.</p>}</article>}
    </section>
  </div>;
}
