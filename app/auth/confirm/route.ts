import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const destinations: Record<string, string> = {
  invite: "/set-password",
  recovery: "/set-password?mode=recovery",
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next");
  const supabase = await createClient();

  if (tokenHash && (type === "invite" || type === "recovery")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return NextResponse.redirect(new URL("/login?recovery=expired", url.origin));
    return NextResponse.redirect(new URL(destinations[type], url.origin));
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    const allowedNext = requestedNext === destinations.invite || requestedNext === destinations.recovery;
    if (!error && allowedNext) return NextResponse.redirect(new URL(requestedNext, url.origin));
  }

  return NextResponse.redirect(new URL("/login?recovery=invalid", url.origin));
}

