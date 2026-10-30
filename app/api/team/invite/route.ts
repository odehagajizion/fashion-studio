import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) return NextResponse.json({ error: "Sign in to invite a team member." }, { status: 401 });

  const { data: membership } = await supabase.from("business_memberships").select("business_id, role")
    .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
  if (membership?.role !== "owner") return NextResponse.json({ error: "Owner access is required." }, { status: 403 });

  let body: { email?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Enter an email and team role." }, { status: 400 }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role === "supervisor" || body.role === "tailor" ? body.role : null;
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) {
    return NextResponse.json({ error: "Enter a valid email and choose supervisor or tailor." }, { status: 400 });
  }

  const { data: members, error: listError } = await supabase.rpc("list_business_team");
  if (listError) return NextResponse.json({ error: "Could not check the studio roster. Apply the latest team migration." }, { status: 500 });
  if (members?.some((member: { email: string }) => member.email.toLowerCase() === email)) {
    return NextResponse.json({ error: "That email is already linked to this studio." }, { status: 409 });
  }

  try {
    const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: origin + "/auth/confirm?next=%2Fset-password",
      data: { studio_role: role },
    });
    if (error || !data.user) return NextResponse.json({ error: "Supabase could not send the invitation. Check Auth email delivery and try again." }, { status: 502 });

    const { error: linkError } = await supabase.rpc("link_invited_team_member", {
      p_user_id: data.user.id, p_role: role, p_email: email,
    });
    if (linkError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return NextResponse.json({ error: "The account was invited, but could not be linked to this studio. The invitation was canceled; try again." }, { status: 500 });
    }

    return NextResponse.json({ email, role, userId: data.user.id });
  } catch {
    return NextResponse.json({ error: "Invitations need the server-side Supabase service key and working Auth email delivery." }, { status: 503 });
  }
}

