"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type TeamMember = { user_id: string; email: string; role: "owner" | "supervisor" | "tailor"; is_active: boolean; created_at: string };
type TeamDraft = { role: "supervisor" | "tailor"; is_active: boolean };
const roleLabels = { owner: "Owner", supervisor: "Supervisor", tailor: "Tailor" } as const;

export default function TeamClient({ members }: { members: TeamMember[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, TeamDraft>>(() => Object.fromEntries(members.filter(member => member.role !== "owner").map(member => [member.user_id, { role: member.role as TeamDraft["role"], is_active: member.is_active }])));
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");


  async function save(member: TeamMember) {
    const draft = drafts[member.user_id];
    if (!draft) return;
    setSaving(member.user_id);
    setFeedback("");
    const { error } = await createClient().rpc("update_business_team_member", {
      p_user_id: member.user_id, p_role: draft.role, p_is_active: draft.is_active,
    });
    if (error) {
      setFeedback("We couldn’t save the team member’s access. Refresh the page and try again.");
      setSaving(null);
      return;
    }
    setFeedback(member.is_active && !draft.is_active ? "Access paused. Active order assignments were cleared and recorded in the order history." : "Team member access updated and recorded.");
    setSaving(null);
    router.refresh();
  }

  const changed = (member: TeamMember) => {
    const draft = drafts[member.user_id];
    return Boolean(draft && (draft.role !== member.role || draft.is_active !== member.is_active));
  };

  return <div className="team-workspace">
    <div className="team-summary">
      <article><span>Team members</span><strong>{members.filter(member => member.role !== "owner").length}</strong><small>Owner account is listed below</small></article>
      <article><span>Active access</span><strong>{members.filter(member => member.role !== "owner" && member.is_active).length}</strong><small>People who can sign in to the studio</small></article>
    </div>
    {feedback && <p className="customer-feedback" role="status">{feedback}</p>}
    <section className="team-panel panel">
      <header className="panel-heading"><div><h2>Studio roster</h2><p>Role and access changes take effect when saved.</p></div></header>
      {members.length === 0 ? <div className="payment-empty-state"><h3>No team accounts linked</h3><p>Create the person’s login in Supabase Authentication, then use the repository’s team setup SQL to link their account to this studio.</p></div> : <div className="team-list">{members.map(member => {
        const draft = drafts[member.user_id];
        const isOwner = member.role === "owner";
        return <article className="team-member-card" key={member.user_id}>
          <div className="team-member-identity"><span className="team-avatar">{member.email.slice(0, 1).toUpperCase()}</span><div><strong>{member.email}</strong><small>Added {new Date(member.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div></div>
          <span className={"team-role-badge " + member.role}>{roleLabels[member.role]}</span>
          <span className={"team-status-badge " + (member.is_active ? "active" : "inactive")}>{member.is_active ? "Access active" : "Access paused"}</span>
          {!isOwner && draft && <div className="team-member-controls">
            <label>Role<select value={draft.role} onChange={event => setDrafts(current => ({ ...current, [member.user_id]: { ...draft, role: event.target.value as TeamDraft["role"] } }))}><option value="supervisor">Supervisor</option><option value="tailor">Tailor</option></select></label>
            <label className="team-access-toggle"><input type="checkbox" checked={draft.is_active} onChange={event => setDrafts(current => ({ ...current, [member.user_id]: { ...draft, is_active: event.target.checked } }))} /><span>{draft.is_active ? "Allow sign-in" : "Pause access"}</span></label>
            <button className="button button-primary small-button" disabled={!changed(member) || saving === member.user_id} onClick={() => save(member)}>{saving === member.user_id ? "Saving…" : "Save changes"}</button>
          </div>}
          {isOwner && <small className="team-owner-note">Owner access is protected from team changes.</small>}
        </article>;
      })}</div>}
    </section>
    <aside className="team-invite-note"><strong>Adding a new person</strong><p>Account invitations are not part of this screen yet. Create a login in Supabase Authentication and link it with the team setup SQL. In-app invitations can be added after the email delivery settings are configured.</p></aside>
  </div>;
}

