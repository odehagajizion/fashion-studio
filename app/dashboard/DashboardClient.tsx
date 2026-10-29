"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type NavItem = { label: string; icon: string };
type DashboardData = {
  role: string; canViewFinance: boolean; totalCustomers: number; activeOrders: number; overdueOrders: number;
  receivedThisMonth: number; outstanding: number; paymentsByMonth: { key: string; label: string; amount: number }[];
  stages: { name: string; count: number; color: string }[];
  deadlines: { ref: string; name: string; due: string; tone: string }[];
  recentOrders: { ref: string; name: string; status: string; amount: string; tone: string }[];
  recentPayments: { id: string; amount: string; name: string; method: string; date: string; negative: boolean }[];
  dataError: boolean;
};

const groups: { title: string; items: NavItem[] }[] = [
  { title: "MAIN", items: [{ label: "Dashboard", icon: "▦" }, { label: "Customers", icon: "♙" }, { label: "Orders", icon: "▤" }, { label: "Calendar", icon: "▦" }] },
  { title: "MANAGEMENT", items: [{ label: "Measurements", icon: "⌁" }, { label: "Production", icon: "◷" }, { label: "Team", icon: "♧" }] },
  { title: "FINANCE", items: [{ label: "Payments", icon: "₦" }, { label: "Reports", icon: "▥" }] },
];
const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const compactCurrency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", notation: "compact", maximumFractionDigits: 0 });

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><span className="more" aria-hidden="true">···</span></header>{children}</section>;
}

export default function DashboardClient({ data }: { data: DashboardData }) {
  const router = useRouter();
  const [active, setActive] = useState("Dashboard");
  const [toast, setToast] = useState("");
  const announce = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const handleSignOut = async () => { await createClient().auth.signOut(); window.location.assign("/login"); };
  const roleLabel = data.role === "owner" ? "Owner" : data.role === "supervisor" ? "Supervisor" : "Tailor";
  const today = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(new Date());
  const months = data.paymentsByMonth;
  const maxPayment = Math.max(0, ...months.map(month => Math.max(0, month.amount)));
  const chartScale = maxPayment || 1;
  const visibleGroups = data.canViewFinance ? groups : groups.filter(group => group.title !== "FINANCE");
  const customerLabel = data.role === "tailor" ? "Assigned customers" : "Total customers";
  const overdueLabel = data.overdueOrders === 1 ? "1 overdue" : `${data.overdueOrders} overdue`;

  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#dashboard" onClick={() => setActive("Dashboard")}><span className="brand-mark">M</span><span>MvendyWendy</span></a>
      <nav aria-label="Main navigation">{visibleGroups.map(group => <div className="nav-group" key={group.title}><p className="group-label">{group.title}</p>{group.items.map(item => <button key={item.label} className={`nav-item ${active === item.label ? "selected" : ""}`} onClick={() => { if (item.label === "Customers") { router.push("/customers"); return; } if (item.label === "Orders" || item.label === "Production") { router.push("/orders"); return; } if (item.label === "Calendar") { router.push("/calendar"); return; } if (item.label === "Payments") { router.push("/payments"); return; } if (item.label === "Reports") { router.push("/reports"); return; } setActive(item.label); if (item.label !== "Dashboard") announce(`${item.label} workspace is coming next.`); }}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</div>)}<div className="nav-group nav-settings"><button className={`nav-item ${active === "Settings" ? "selected" : ""}`} onClick={() => { setActive("Settings"); announce("Settings workspace is coming next."); }}><span className="nav-icon">⚙</span>Settings</button></div></nav>
      <div className="sidebar-foot"><div className="avatar">{roleLabel.slice(0, 1)}W</div><div><strong>{roleLabel} workspace</strong><span>Fashion studio</span></div><span className="chevron">⌄</span></div>
    </aside>
    <section className="main-area" id="dashboard">
      <div className="topline"><div><p className="eyebrow">{today.toLocaleUpperCase()}</p><h1>Welcome back, {roleLabel} <span className="wave">✦</span></h1><p className="page-subtitle">Here’s what’s happening in your studio today.</p></div><div className="top-actions">{data.role !== "tailor" && <><button className="button button-secondary" onClick={() => router.push("/customers")}><span>＋</span> New customer</button><button className="button button-primary" onClick={() => router.push("/orders")}><span>＋</span> New order</button></>}<button className="button button-secondary sign-out" onClick={handleSignOut}>Sign out</button><button className="icon-button notifications" aria-label="Notifications" onClick={() => announce("You’re all caught up.")}>♧<i /></button></div></div>
      {data.dataError && <div className="notice notice-error" role="status"><span className="notice-dot" /><span><strong>Some dashboard data could not be loaded.</strong> Check that the required Supabase migrations are applied, then refresh.</span></div>}
      <section className={`stats-grid ${data.canViewFinance ? "" : "stats-operational"}`} aria-label="Studio overview">
        <article className="stat-card"><div className="stat-top"><span>{customerLabel}</span><span className="stat-icon icon-sage">♙</span></div><strong className="stat-value">{data.totalCustomers.toLocaleString("en-NG")}</strong><div className="stat-foot"><span className="muted">{data.role === "tailor" ? "linked to your assigned work" : "active in your studio"}</span></div></article>
        <article className="stat-card"><div className="stat-top"><span>Active orders</span><span className="stat-icon icon-ink">▤</span></div><strong className="stat-value">{data.activeOrders.toLocaleString("en-NG")}</strong><div className="stat-foot"><span className="muted">across production stages</span><span className="alert-count">{overdueLabel}</span></div></article>
        {data.canViewFinance && <><article className="stat-card"><div className="stat-top"><span>Received this month</span><span className="stat-icon icon-olive">₦</span></div><strong className="stat-value money">{currency.format(data.receivedThisMonth)}</strong><div className="stat-foot"><span className="muted">confirmed payments less adjustments</span></div></article><article className="stat-card"><div className="stat-top"><span>Still owed</span><span className="stat-icon icon-red">◷</span></div><strong className="stat-value money owed">{currency.format(data.outstanding)}</strong><div className="stat-foot"><span className="muted">across active orders</span><button className="stat-link" onClick={() => router.push("/payments")}>View balances →</button></div></article></>}
      </section>
      <section className={`middle-grid ${data.canViewFinance ? "" : "operational-middle"}`}>
        {data.canViewFinance && <Card title="Payments received" subtitle="Net confirmed payments · last 6 months" className="chart-panel"><div className="chart-legend"><span><i /> Payments</span><span className="chart-total">{compactCurrency.format(data.receivedThisMonth)} <small>this month</small></span></div><div className="chart"><div className="y-axis">{[1, .75, .5, .25, 0].map(tick => <span key={tick}>{compactCurrency.format(maxPayment * tick)}</span>)}</div><div className="chart-plot"><div className="grid-lines"><i /><i /><i /><i /><i /></div><div className="bars">{months.map(month => <div className="bar-column" key={month.key}><div className={`bar ${month.key === months.at(-1)?.key ? "bar-current" : ""} ${month.amount <= 0 ? "bar-empty" : ""}`} style={{ height: `${Math.max(month.amount > 0 ? 5 : 0, Math.max(0, month.amount) / chartScale * 205)}px` }}><span className="bar-tooltip">{currency.format(month.amount)}</span></div><span className="month-label">{month.label}</span></div>)}</div></div></div></Card>}
        <Card title="Orders by status" subtitle={`Current production stage · ${data.activeOrders} active orders`} className="status-panel"><div className="stage-list">{data.stages.map(stage => <div className="stage-row" key={stage.name}><span className="stage-name">{stage.name}</span><div className="progress-track"><span className={`progress-fill ${stage.color}`} style={{ width: `${data.activeOrders ? stage.count / data.activeOrders * 100 : 0}%` }} /></div><strong>{stage.count}</strong></div>)}</div><div className="status-foot"><span><i className="pulse" /> Live overview</span><button onClick={() => router.push("/orders")}>View all orders →</button></div></Card>
      </section>
      <section className={`bottom-grid ${data.canViewFinance ? "" : "operational-bottom"}`}>
        <Card title="Upcoming deadlines" subtitle="Overdue and due soon" className="list-panel">{data.deadlines.length ? <div className="deadline-list">{data.deadlines.map(item => <div className={`deadline-item ${item.tone}`} key={item.ref}><div className="list-main"><strong>{item.ref}</strong><span>{item.name}</span></div><span className="deadline-badge">{item.due}</span></div>)}</div> : <p className="dashboard-empty">No dated active orders yet.</p>}<button className="text-link" onClick={() => { router.push("/orders"); }}>Open orders <span>→</span></button></Card>
        <Card title="Recent orders" subtitle="Latest order activity" className="list-panel">{data.recentOrders.length ? <div className="record-list">{data.recentOrders.map(item => <div className="record-item" key={item.ref}><div className="list-main"><strong>{item.ref}</strong><span>{item.name}</span></div><div className="record-meta"><span className={`status-pill ${item.tone}`}>{item.status}</span>{item.amount && <strong>{item.amount}</strong>}</div></div>)}</div> : <p className="dashboard-empty">Orders will appear here when you create the first one.</p>}<button className="text-link" onClick={() => router.push("/orders")}>All orders <span>→</span></button></Card>
        {data.canViewFinance && <Card title="Recent payments" subtitle="Latest receipts and adjustments" className="list-panel">{data.recentPayments.length ? <div className="record-list">{data.recentPayments.map(item => <div className="record-item payment-item" key={item.id}><div className="list-main"><strong className={`payment-amount ${item.negative ? "payment-negative" : ""}`}>{item.amount}</strong><span>{item.name}</span></div><div className="record-meta"><span className="method-pill">{item.method}</span><span className="date-text">{item.date}</span></div></div>)}</div> : <p className="dashboard-empty">Confirmed receipts will appear here.</p>}<button className="text-link" onClick={() => router.push("/payments")}>Payment history <span>→</span></button></Card>}
      </section>
      <footer className="page-footer"><span>Made with care for your studio <span className="footer-heart">♥</span></span><span>MVENDYWENDY · {roleLabel.toUpperCase()} WORKSPACE</span></footer>
    </section>
    {toast && <div className="toast" role="status"><span>✦</span>{toast}</div>}
  </main>;
}
