"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type Customer = {
  id: string;
  customer_ref: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  created_at: string;
};
type Measurement = { id: string; measurement_session_id: string; field_name: string; value: number | string; unit: "cm" | "in"; note: string | null };
type MeasurementSession = { id: string; customer_id: string; taken_at: string; notes: string | null; measurements: Measurement[] };
type MeasurementField = { field_name: string; value: string; unit: "cm" | "in" };

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function CustomerManager({ businessId, initialCustomers, initialSessions }: {
  businessId: string;
  initialCustomers: Customer[];
  initialSessions: MeasurementSession[];
}) {
  const router = useRouter();
  const [customers, setCustomers] = useState(initialCustomers);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [measurementCustomer, setMeasurementCustomer] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [takenAt, setTakenAt] = useState(localDate);
  const [sessionNotes, setSessionNotes] = useState("");
  const [fields, setFields] = useState<MeasurementField[]>([
    { field_name: "Bust", value: "", unit: "cm" },
    { field_name: "Waist", value: "", unit: "cm" },
    { field_name: "Hip", value: "", unit: "cm" },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  const visibleCustomers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return customers;
    return customers.filter(customer => `${customer.customer_ref} ${customer.first_name} ${customer.last_name} ${customer.phone} ${customer.email ?? ""}`.toLocaleLowerCase().includes(needle));
  }, [customers, search]);

  function resetCustomerForm() {
    setFirstName(""); setLastName(""); setPhone(""); setEmail(""); setNotes(""); setEditing(null); setShowForm(false); setFeedback("");
  }

  function beginEdit(customer: Customer) {
    setEditing(customer); setFirstName(customer.first_name); setLastName(customer.last_name);
    setPhone(customer.phone); setEmail(customer.email ?? ""); setNotes(customer.notes ?? ""); setShowForm(true); setFeedback("");
  }

  async function saveCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    const normalizedPhone = phone.trim();
    const duplicate = customers.find(customer => customer.id !== editing?.id && customer.phone.trim().toLocaleLowerCase() === normalizedPhone.toLocaleLowerCase());
    if (duplicate) {
      setFeedback(`This phone number is already on ${duplicate.first_name} ${duplicate.last_name} (${duplicate.customer_ref}).`);
      return;
    }

    setIsSaving(true);
    const supabase = createClient();
    if (editing) {
      const { data, error } = await supabase.from("customers").update({
        first_name: firstName.trim(), last_name: lastName.trim(), phone: normalizedPhone,
        email: email.trim() || null, notes: notes.trim() || null,
      }).eq("id", editing.id).eq("business_id", businessId)
        .select("id, customer_ref, first_name, last_name, phone, email, notes, created_at").single();
      if (error) { setFeedback("We couldn’t update this customer. Check the details and try again."); setIsSaving(false); return; }
      setCustomers(current => current.map(customer => customer.id === data.id ? data as Customer : customer));
    } else {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setFeedback("Your session ended. Sign in again to continue."); setIsSaving(false); return; }
      const { data, error } = await supabase.from("customers").insert({
        business_id: businessId, created_by: auth.user.id,
        first_name: firstName.trim(), last_name: lastName.trim(), phone: normalizedPhone,
        email: email.trim() || null, notes: notes.trim() || null,
      }).select("id, customer_ref, first_name, last_name, phone, email, notes, created_at").single();
      if (error) { setFeedback("We couldn’t save this customer. Check the details and try again."); setIsSaving(false); return; }
      setCustomers(current => [data as Customer, ...current]);
    }
    setIsSaving(false);
    resetCustomerForm();
    router.refresh();
  }

  async function archiveCustomer(customer: Customer) {
    if (!window.confirm(`Archive ${customer.first_name} ${customer.last_name}? Their order and measurement history will remain saved.`)) return;
    const { error } = await createClient().from("customers").update({ archived_at: new Date().toISOString() })
      .eq("id", customer.id).eq("business_id", businessId);
    if (error) { setFeedback("We couldn’t archive this customer. Please try again."); return; }
    setCustomers(current => current.filter(item => item.id !== customer.id));
    router.refresh();
  }

  async function saveMeasurements(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    const cleaned = fields.map(field => ({ ...field, field_name: field.field_name.trim(), value: field.value.trim() }));
    if (cleaned.some(field => !field.field_name || !field.value || !Number.isFinite(Number(field.value)) || Number(field.value) <= 0)) {
      setFeedback("Enter a name and a positive value for every measurement field.");
      return;
    }
    const uniqueNames = new Set(cleaned.map(field => field.field_name.toLocaleLowerCase()));
    if (uniqueNames.size !== cleaned.length) {
      setFeedback("Each measurement field name must be unique in this session.");
      return;
    }
    setIsSaving(true);
    const { error } = await createClient().rpc("create_measurement_session", {
      p_customer_id: measurementCustomer,
      p_taken_at: takenAt,
      p_notes: sessionNotes.trim() || null,
      p_measurements: cleaned.map(field => ({ field_name: field.field_name, value: Number(field.value), unit: field.unit })),
    });
    if (error) {
      setFeedback("We couldn’t save these measurements. Check the values and try again.");
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    setMeasurementCustomer(null);
    setSessionNotes("");
    setFields([{ field_name: "Bust", value: "", unit: "cm" }, { field_name: "Waist", value: "", unit: "cm" }, { field_name: "Hip", value: "", unit: "cm" }]);
    router.refresh();
  }

  return <div className="customer-workspace">
    <div className="customer-toolbar">
      <div className="customer-count"><strong>{customers.length}</strong><span>{customers.length === 1 ? "customer" : "customers"} in your studio</span></div>
      <div className="customer-toolbar-actions"><label className="customer-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search name, phone, or reference" value={search} onChange={event => setSearch(event.target.value)} aria-label="Search customers" /></label><button className="button button-primary" onClick={() => { resetCustomerForm(); setShowForm(true); }}><span>＋</span> Add customer</button></div>
    </div>

    {feedback && <p className="customer-feedback" role="status">{feedback}</p>}

    {showForm && <section className="customer-form-card">
      <div className="customer-form-heading"><div><p className="eyebrow">CUSTOMER PROFILE</p><h2>{editing ? "Edit customer" : "Add a customer"}</h2></div><button className="close-button" onClick={resetCustomerForm} aria-label="Close form">×</button></div>
      <form className="customer-form" onSubmit={saveCustomer}>
        <label>First name<input required maxLength={80} value={firstName} onChange={event => setFirstName(event.target.value)} /></label>
        <label>Last name<input required maxLength={80} value={lastName} onChange={event => setLastName(event.target.value)} /></label>
        <label>Phone number<input required maxLength={40} type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label>
        <label>Email address <span className="optional">Optional</span><input maxLength={254} type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="form-wide">Notes <span className="optional">Optional</span><textarea maxLength={2000} rows={3} value={notes} onChange={event => setNotes(event.target.value)} /></label>
        <div className="form-actions form-wide"><button type="button" className="button button-secondary" onClick={resetCustomerForm}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving}>{isSaving ? "Saving…" : editing ? "Save changes" : "Save customer"}</button></div>
      </form>
    </section>}

    <div className="customer-list-heading"><h2>Customer directory</h2><span>Names and phone numbers help identify possible duplicates.</span></div>
    {visibleCustomers.length === 0 ? <div className="empty-customers"><div className="empty-icon">♙</div><h3>{search ? "No customers match that search" : "Your customer list starts here"}</h3><p>{search ? "Try another name, phone number, or customer reference." : "Add your first customer to keep their contact details and measurements together."}</p>{!search && <button className="button button-primary" onClick={() => setShowForm(true)}>＋ Add first customer</button>}</div> : <div className="customer-list">{visibleCustomers.map(customer => {
      const sessions = initialSessions.filter(session => session.customer_id === customer.id);
      return <article className="customer-card" key={customer.id}>
        <div className="customer-card-top"><div className="customer-identity"><div className="customer-avatar">{customer.first_name.slice(0, 1)}{customer.last_name.slice(0, 1)}</div><div><span className="customer-reference">{customer.customer_ref}</span><h3>{customer.first_name} {customer.last_name}</h3></div></div><div className="customer-actions"><button className="button button-secondary small-button" onClick={() => beginEdit(customer)}>Edit</button><button className="text-link archive-button" onClick={() => archiveCustomer(customer)}>Archive</button></div></div>
        <div className="customer-details"><span><i>☎</i>{customer.phone}</span>{customer.email && <span><i>✉</i>{customer.email}</span>}<span><i>⌁</i>{sessions.length} measurement {sessions.length === 1 ? "session" : "sessions"}</span></div>
        {customer.notes && <p className="customer-notes">{customer.notes}</p>}
        {sessions[0] && <div className="measurement-history"><div className="latest-measurements"><div className="latest-measurements-heading"><strong>Latest measurements</strong><span>{new Date(`${sessions[0].taken_at}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span></div><div className="measurement-chips">{sessions[0].measurements.map(item => <span key={item.id}><strong>{item.field_name}</strong> {item.value}{item.unit}</span>)}</div></div>{sessions.length > 1 && <details className="older-measurements"><summary>View {sessions.length - 1} earlier {sessions.length === 2 ? "session" : "sessions"}</summary><div className="older-session-list">{sessions.slice(1).map(session => <div key={session.id}><strong>{new Date(`${session.taken_at}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</strong><div className="measurement-chips">{session.measurements.map(item => <span key={item.id}><strong>{item.field_name}</strong> {item.value}{item.unit}</span>)}</div>{session.notes && <p>{session.notes}</p>}</div>)}</div></details>}</div>}
        {measurementCustomer === customer.id && <form className="measurement-form" onSubmit={saveMeasurements}>
          <div className="customer-form-heading"><div><p className="eyebrow">MEASUREMENT HISTORY</p><h3>New session for {customer.first_name}</h3></div><button type="button" className="close-button" onClick={() => setMeasurementCustomer(null)} aria-label="Close measurement form">×</button></div>
          <label className="session-date">Measurement date<input type="date" value={takenAt} onChange={event => setTakenAt(event.target.value)} required /></label>
          <div className="measurement-fields">{fields.map((field, index) => <div className="measurement-field-row" key={index}>
            <label>Measurement<input required maxLength={80} placeholder="e.g. Sleeve length" value={field.field_name} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, field_name: event.target.value } : item))} /></label>
            <label>Value<input required type="number" min="0.01" max="1000" step="0.01" placeholder="0.00" value={field.value} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} /></label>
            <label>Unit<select value={field.unit} onChange={event => setFields(current => current.map((item, i) => i === index ? { ...item, unit: event.target.value as "cm" | "in" } : item))}><option value="cm">cm</option><option value="in">in</option></select></label>
            <button type="button" className="remove-field" onClick={() => setFields(current => current.filter((_, i) => i !== index))} aria-label={`Remove ${field.field_name || "measurement"}`}>×</button>
          </div>)}</div>
          <button type="button" className="text-link add-field" onClick={() => setFields(current => [...current, { field_name: "", value: "", unit: "cm" }])}>＋ Add another measurement</button>
          <label className="session-notes">Session notes<textarea rows={2} maxLength={1000} value={sessionNotes} onChange={event => setSessionNotes(event.target.value)} /></label>
          <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setMeasurementCustomer(null)}>Cancel</button><button type="submit" className="button button-primary" disabled={isSaving || fields.length === 0}>{isSaving ? "Saving…" : "Save measurement session"}</button></div>
        </form>}
        {measurementCustomer !== customer.id && <button className="text-link add-measurement" onClick={() => { setFeedback(""); setMeasurementCustomer(customer.id); setTakenAt(localDate()); }}>＋ Record measurements</button>}
      </article>;
    })}</div>}
  </div>;
}


