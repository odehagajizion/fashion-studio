"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type NavItem = { label: string; icon: string };

const groups: { title: string; items: NavItem[] }[] = [
  { title: "MAIN", items: [{ label: "Dashboard", icon: "▦" }, { label: "Customers", icon: "♙" }, { label: "Orders", icon: "▤" }, { label: "Calendar", icon: "▦" }] },
  { title: "MANAGEMENT", items: [{ label: "Measurements", icon: "⌁" }, { label: "Production", icon: "◷" }, { label: "Team", icon: "♧" }] },
  { title: "FINANCE", items: [{ label: "Payments", icon: "₦" }, { label: "Reports", icon: "▥" }] },
];
const months = [{ m: "May", h: 70 }, { m: "Jun", h: 116 }, { m: "Jul", h: 101 }, { m: "Aug", h: 145 }, { m: "Sep", h: 170 }, { m: "Oct", h: 205 }];
const stages = [{ name: "Not started", count: 4, color: "sage" }, { name: "In production", count: 11, color: "olive" }, { name: "Awaiting fitting", count: 4, color: "gold" }, { name: "Ready for pickup", count: 5, color: "red" }];
const deadlines = [{ ref: "ORD-0118", name: "Ngozi Eze", due: "3 days overdue", tone: "late" }, { ref: "ORD-0121", name: "Chidi Obi", due: "2 days overdue", tone: "late" }, { ref: "ORD-0126", name: "Amina Bello", due: "Due today", tone: "today" }, { ref: "ORD-0129", name: "Femi Ade", due: "Due in 2 days", tone: "soon" }];
const recentOrders = [{ ref: "ORD-0131", name: "Tola Adeyemi", status: "In production", amount: "₦85,000", tone: "olive" }, { ref: "ORD-0130", name: "Kemi Salako", status: "Not started", amount: "₦40,000", tone: "neutral" }, { ref: "ORD-0129", name: "Femi Ade", status: "Ready for pickup", amount: "₦120,000", tone: "late" }];
const payments = [{ amount: "+₦30,000", name: "Amina Bello", method: "Transfer", date: "28 Oct" }, { amount: "+₦25,000", name: "Tola Adeyemi", method: "Transfer", date: "27 Oct" }, { amount: "+₦50,000", name: "Chidi Obi", method: "Manual", date: "26 Oct" }];

function Card({ title, subtitle, children, className = "" }: { title: string; subtitle?: string; children: React.ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><header className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="more" aria-label={`More ${title} options`}>···</button></header>{children}</section>;
}

export default function Home() {
  const [active, setActive] = useState("Dashboard");
  const [toast, setToast] = useState("");
  const announce = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); };
  const handleSignOut = async () => { await createClient().auth.signOut(); window.location.assign("/login"); };
  return <main className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#dashboard" onClick={() => setActive("Dashboard")}><span className="brand-mark">M</span><span>MvendyWendy</span></a>
      <nav aria-label="Main navigation">{groups.map(group => <div className="nav-group" key={group.title}><p className="group-label">{group.title}</p>{group.items.map(item => <button key={item.label} className={`nav-item ${active === item.label ? "selected" : ""}`} onClick={() => { setActive(item.label); if (item.label !== "Dashboard") announce(`${item.label} workspace is coming next.`); }}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</div>)}<div className="nav-group nav-settings"><button className={`nav-item ${active === "Settings" ? "selected" : ""}`} onClick={() => { setActive("Settings"); announce("Settings workspace is coming next."); }}><span className="nav-icon">⚙</span>Settings</button></div></nav>
      <div className="sidebar-foot"><div className="avatar">OW</div><div><strong>Owner workspace</strong><span>Fashion studio</span></div><span className="chevron">⌄</span></div>
    </aside>
    <section className="main-area" id="dashboard">
      <div className="topline"><div><p className="eyebrow">THURSDAY · 29 OCTOBER 2026</p><h1>Welcome back, Owner <span className="wave">✦</span></h1><p className="page-subtitle">Here’s what’s happening in your studio today.</p></div><div className="top-actions"><button className="button button-secondary" onClick={() => announce("Customer registration is the next workflow to build.")}><span>＋</span> New customer</button><button className="button button-primary" onClick={() => announce("Order creation is the next workflow to build.")}><span>＋</span> New order</button><button className="button button-secondary sign-out" onClick={handleSignOut}>Sign out</button><button className="icon-button notifications" aria-label="Notifications" onClick={() => announce("You’re all caught up.")}>♧<i /></button></div></div>
      <div className="notice"><span className="notice-dot" /><span><strong>Illustration mode</strong> — these figures are sample data, not connected to a database yet.</span><button onClick={() => announce("We’ll connect your studio data as the next foundation step.")}>Learn more <span>→</span></button></div>
      <section className="stats-grid" aria-label="Studio overview">
        <article className="stat-card"><div className="stat-top"><span>Total customers</span><span className="stat-icon icon-sage">♙</span></div><strong className="stat-value">128</strong><div className="stat-foot"><span className="muted">registered in your studio</span><span className="trend">↗ 12%</span></div></article>
        <article className="stat-card"><div className="stat-top"><span>Active orders</span><span className="stat-icon icon-ink">▤</span></div><strong className="stat-value">24</strong><div className="stat-foot"><span className="muted">across all stages</span><span className="alert-count">3 overdue</span></div></article>
        <article className="stat-card"><div className="stat-top"><span>Received this month</span><span className="stat-icon icon-olive">₦</span></div><strong className="stat-value money">₦1,320,000</strong><div className="stat-foot"><span className="muted">confirmed payments</span><span className="trend">↗ 8.4%</span></div></article>
        <article className="stat-card"><div className="stat-top"><span>Still owed</span><span className="stat-icon icon-red">◷</span></div><strong className="stat-value money owed">₦1,130,000</strong><div className="stat-foot"><span className="muted">across active orders</span><span className="muted">View balances →</span></div></article>
      </section>
      <section className="middle-grid">
        <Card title="Payments received" subtitle="Confirmed payments · last 6 months" className="chart-panel"><div className="chart-legend"><span><i /> Payments</span><span className="chart-total">₦1.32m <small>this month</small></span></div><div className="chart"><div className="y-axis"><span>₦400k</span><span>₦300k</span><span>₦200k</span><span>₦100k</span><span>₦0</span></div><div className="chart-plot"><div className="grid-lines"><i /><i /><i /><i /><i /></div><div className="bars">{months.map((item, index) => <div className="bar-column" key={item.m}><div className={`bar ${index === months.length - 1 ? "bar-current" : ""}`} style={{ height: `${item.h}px` }}><span className="bar-tooltip">₦{[140, 230, 200, 290, 340, 410][index]}k</span></div><span className="month-label">{item.m}</span></div>)}</div></div></div></Card>
        <Card title="Orders by status" subtitle="Current production stage · 24 active orders" className="status-panel"><div className="stage-list">{stages.map(stage => <div className="stage-row" key={stage.name}><span className="stage-name">{stage.name}</span><div className="progress-track"><span className={`progress-fill ${stage.color}`} style={{ width: `${stage.count / 24 * 100}%` }} /></div><strong>{stage.count}</strong></div>)}</div><div className="status-foot"><span><i className="pulse" /> Live overview</span><button onClick={() => { setActive("Orders"); announce("Orders workspace is coming next."); }}>View all orders →</button></div></Card>
      </section>
      <section className="bottom-grid">
        <Card title="Upcoming deadlines" subtitle="Overdue and due soon" className="list-panel"><div className="deadline-list">{deadlines.map(item => <div className={`deadline-item ${item.tone}`} key={item.ref}><div className="list-main"><strong>{item.ref}</strong><span>{item.name}</span></div><span className="deadline-badge">{item.due}</span></div>)}</div><button className="text-link" onClick={() => { setActive("Calendar"); announce("Calendar workspace is coming next."); }}>Open calendar <span>→</span></button></Card>
        <Card title="Recent orders" subtitle="Latest order activity" className="list-panel"><div className="record-list">{recentOrders.map(item => <div className="record-item" key={item.ref}><div className="list-main"><strong>{item.ref}</strong><span>{item.name}</span></div><div className="record-meta"><span className={`status-pill ${item.tone}`}>{item.status}</span><strong>{item.amount}</strong></div></div>)}</div><button className="text-link" onClick={() => { setActive("Orders"); announce("Orders workspace is coming next."); }}>All orders <span>→</span></button></Card>
        <Card title="Recent payments" subtitle="Confirmed money coming in" className="list-panel"><div className="record-list">{payments.map(item => <div className="record-item payment-item" key={item.name}><div className="list-main"><strong className="payment-amount">{item.amount}</strong><span>{item.name}</span></div><div className="record-meta"><span className="method-pill">{item.method}</span><span className="date-text">{item.date}</span></div></div>)}</div><button className="text-link" onClick={() => { setActive("Payments"); announce("Payments workspace is coming next."); }}>Payment history <span>→</span></button></Card>
      </section>
      <footer className="page-footer"><span>Made with care for your studio <span className="footer-heart">♥</span></span><span>MVENDYWENDY · OWNER WORKSPACE</span></footer>
    </section>
    {toast && <div className="toast" role="status"><span>✦</span>{toast}</div>}
  </main>;
}

