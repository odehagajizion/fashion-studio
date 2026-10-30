"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

type TeamMember = { user_id: string; email: string; role: "owner" | "supervisor" | "tailor"; is_active: boolean; created_at: string; invite_pending: boolean };
type TeamDraft = { role: "supervisor" | "tailor"; is_active: boolean };
const roleLabels = { owner: "Owner", supervisor: "Supervisor", tailor: "Tailor" } as const;

export default function TeamClient({ members }: { members: TeamMember[] }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, TeamDraft>>(() => Object.fromEntries(members.filter(member => member.role !== "owner").map(member => [member.user_id, { role: member.role as TeamDraft["role"], is_active: member.is_active }])));
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"supervisor" | "tailor">("tailor");
  const [isInviting, setIsInviting] = useState(false);

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

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback("");
    setIsInviting(true);
    try {
      const response = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFeedback(result.error ?? "We couldn’t send this invitation.");
        setIsInviting(false);
        return;
      }
      setFeedback("Invitation sent to " + result.email + ". They’ll appear in the roster as pending until they accept.");
      setDrafts(current => ({ ...current, [result.userId]: { role: inviteRole, is_active: true } }));
      setInviteEmail("");
      setInviteRole("tailor");
      setShowInvite(false);
      setIsInviting(false);
      router.refresh();
    } catch {
      setFeedback("We couldn’t reach the invitation service. Try again.");
      setIsInviting(false);
    }
  }

  const changed = (member: TeamMember) => {
    const draft = drafts[member.user_id];
    return Boolean(draft && (draft.role !== member.role || draft.is_active !== member.is_active));
  };

  return <div className="team-workspace">
    <div className="team-summary">
      <article><span>Team members</span><strong>{members.filter(member => member.role !== "owner").length}</strong><small>Owner account is listed below</small></article>
      <article><span>Active access</span><strong>{members.filter(member => member.role !== "owner" && member.is_active && !member.invite_pending).length}</strong><small>People who accepted their invitation</small></article>
    </div>
    {feedback && <p className="customer-feedback" role="status">{feedback}</p>}
    <section className="team-panel panel">
      <header className="panel-heading"><div><h2>Studio roster</h2><p>Role and access changes take effect when saved.</p></div><button type="button" className="button button-primary small-button" onClick={() => { setFeedback(""); setShowInvite(value => !value); }}>{showInvite ? "Close" : "＋ Invite member"}</button></header>
      {showInvite && <form className="team-invite-form" onSubmit={invite}>
        <label>Email address<input type="email" autoComplete="email" maxLength={320} value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="name@example.com" required /></label>
        <label>Studio role<select value={inviteRole} onChange={event => setInviteRole(event.target.value as "supervisor" | "tailor")}><option value="tailor">Tailor</option><option value="supervisor">Supervisor</option></select></label>
        <p className="team-invite-help">Supabase will email a secure setup link. Invitations require Auth email delivery and the app URL to be allowed in Supabase.</p>
        <button className="button button-primary" type="submit" disabled={isInviting}>{isInviting ? "Sending invitation…" : "Send invitation"}</button>
      </form>}
      {members.filter(member => member.role !== "owner").length === 0 && <p className="team-empty-note">No team members yet. Invite a supervisor or tailor to get started.</p>}
      <div className="team-list">{members.map(member => {
        const draft = drafts[member.user_id];
        const isOwner = member.role === "owner";
        return <article className="team-member-card" key={member.user_id}>
          <div className="team-member-identity"><span className="team-avatar">{member.email.slice(0, 1).toUpperCase()}</span><div><strong>{member.email}</strong><small>{member.invite_pending ? "Invited " : "Added "}{new Date(member.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</small></div></div>
          <span className={"team-role-badge " + member.role}>{roleLabels[member.role]}</span>
          <span className={"team-status-badge " + (member.invite_pending && member.is_active ? "pending" : member.is_active ? "active" : "inactive")}>{member.invite_pending && member.is_active ? "Invite pending" : member.is_active ? "Access active" : "Access paused"}</span>
          {!isOwner && draft && <div className="team-member-controls">
            <label>Role<select value={draft.role} onChange={event => setDrafts(current => ({ ...current, [member.user_id]: { ...draft, role: event.target.value as TeamDraft["role"] } }))}><option value="supervisor">Supervisor</option><option value="tailor">Tailor</option></select></label>
            <label className="team-access-toggle"><input type="checkbox" checked={draft.is_active} onChange={event => setDrafts(current => ({ ...current, [member.user_id]: { ...draft, is_active: event.target.checked } }))} /><span>{draft.is_active ? "Allow sign-in" : "Pause access"}</span></label>
            <button type="button" className="button button-primary small-button" disabled={!changed(member) || saving === member.user_id} onClick={() => save(member)}>{saving === member.user_id ? "Saving…" : "Save changes"}</button>
          </div>}
          {isOwner && <small className="team-owner-note">Owner access is protected from team changes.</small>}
        </article>;
      })}</div>
    </section>
    <aside className="team-invite-note"><strong>Invitation setup</strong><p>Allow your app URL and /auth/confirm in Supabase Auth redirects. Update the Invite user email template to send token_hash and type=invite to /auth/confirm. Configure a reliable SMTP sender before inviting real staff.</p></aside>
  </div>;
}

