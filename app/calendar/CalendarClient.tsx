"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type CalendarEvent = { id: string; order_id: string; order_ref: string; customer_name: string; date: string; type: "deadline" | "fitting" | "pickup" | "delivery"; title: string; stage: string };
const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const typeLabels: Record<CalendarEvent["type"], string> = { deadline: "Due", fitting: "Fitting", pickup: "Pickup", delivery: "Delivery" };
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function todayKey() { return localDateKey(new Date()); }
function dateLabel(value: string) { return new Date(`${value}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }

export default function CalendarClient({ events, dataError }: { events: CalendarEvent[]; dataError: boolean }) {
  const today = todayKey();
  const [selectedDate, setSelectedDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [activeTypes, setActiveTypes] = useState<CalendarEvent["type"][]>(["deadline", "fitting", "pickup", "delivery"]);
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = new Date(year, monthNumber - 1, 1);
  const offset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(year, monthNumber - 1, 1 - offset);
  const days = Array.from({ length: 42 }, (_, index) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index));
  const visibleEvents = useMemo(() => events.filter(event => activeTypes.includes(event.type)), [events, activeTypes]);
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    visibleEvents.forEach(event => map.set(event.date, [...(map.get(event.date) ?? []), event]));
    return map;
  }, [visibleEvents]);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const monthEvents = visibleEvents.filter(event => event.date.startsWith(month));
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(new Date(year, monthNumber - 1, 15));
  const weekStart = new Date(`${today}T12:00:00`);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const thisWeekCount = visibleEvents.filter(event => event.date >= localDateKey(weekStart) && event.date < localDateKey(nextWeek)).length;
  const nextMonth = (delta: number) => {
    const date = new Date(year, monthNumber - 1 + delta, 1);
    const key = localDateKey(date).slice(0, 7);
    setMonth(key);
    setSelectedDate(`${key}-01`);
  };
  const toggleType = (type: CalendarEvent["type"]) => setActiveTypes(current => current.includes(type) ? current.filter(item => item !== type) : [...current, type]);

  return <div className="calendar-workspace">
    {dataError && <div className="notice notice-error" role="status"><span className="notice-dot" /><span><strong>Schedule data could not be loaded.</strong> Check your Supabase connection and refresh.</span></div>}
    <div className="calendar-summary"><article><span>Scheduled this month</span><strong>{monthEvents.length}</strong></article><article><span>Events this week</span><strong>{thisWeekCount}</strong></article><article><span>Orders in schedule</span><strong>{new Set(monthEvents.map(event => event.order_id)).size}</strong></article><Link className="button button-primary" href="/orders">Manage order dates →</Link></div>
    <section className="calendar-panel panel">
      <div className="calendar-toolbar"><div><p className="eyebrow">MONTH VIEW</p><h2>{title}</h2></div><div className="calendar-navigation"><button className="button button-secondary" aria-label="Previous month" onClick={() => nextMonth(-1)}>←</button><button className="button button-secondary" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDate(today); }}>Today</button><button className="button button-secondary" aria-label="Next month" onClick={() => nextMonth(1)}>→</button></div></div>
      <div className="calendar-filters" aria-label="Filter calendar events">{(["fitting", "deadline", "pickup", "delivery"] as const).map(type => <button key={type} className={`calendar-filter ${activeTypes.includes(type) ? "active" : ""} ${type}`} aria-pressed={activeTypes.includes(type)} onClick={() => toggleType(type)}><i />{typeLabels[type]}</button>)}</div>
      <div className="calendar-layout">
        <div className="month-grid" role="group" aria-label={`${title} order schedule`}>
          {weekdayNames.map(day => <div className="weekday-label" key={day}>{day}</div>)}
          {days.map(date => {
            const key = localDateKey(date);
            const dateEvents = eventsByDate.get(key) ?? [];
            return <button key={key} aria-label={`${dateLabel(key)} · ${dateEvents.length} events`} aria-pressed={selectedDate === key} className={`calendar-day ${date.getMonth() !== monthNumber - 1 ? "outside-month" : ""} ${selectedDate === key ? "selected-day" : ""} ${key === today ? "today-day" : ""}`} onClick={() => { setSelectedDate(key); if (date.getMonth() !== monthNumber - 1) setMonth(key.slice(0, 7)); }}>
              <span className="calendar-day-number">{date.getDate()}</span>{dateEvents.length > 0 && <span className="calendar-day-count">{dateEvents.length}</span>}
              <span className="calendar-day-events">{dateEvents.slice(0, 2).map(event => <i key={event.id} className={`calendar-mark ${event.type}`} title={`${typeLabels[event.type]} · ${event.order_ref}`} />)}{dateEvents.length > 2 && <small>+{dateEvents.length - 2}</small>}</span>
            </button>;
          })}
        </div>
        <aside className="selected-day-panel"><p className="eyebrow">SELECTED DAY</p><h3>{dateLabel(selectedDate)}</h3>{selectedEvents.length ? <div className="selected-event-list">{selectedEvents.map(event => <article className={`calendar-event ${event.type}`} key={event.id}><div className="calendar-event-top"><span>{typeLabels[event.type]}</span><span className="calendar-event-stage">{event.stage.replaceAll("_", " ")}</span></div><strong>{event.order_ref} · {event.customer_name}</strong><p>{event.title}</p><Link href={`/orders#${event.order_id}`}>View order →</Link></article>)}</div> : <div className="calendar-empty"><span>▦</span><strong>No events scheduled</strong><p>Choose another date or add dates to an order.</p><Link className="text-link" href="/orders">Open Orders →</Link></div>}</aside>
      </div>
    </section>
  </div>;
}
