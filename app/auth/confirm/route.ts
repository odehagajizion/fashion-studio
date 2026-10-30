import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const destination = new URL("/set-password", url.origin);

  if (!tokenHash || type !== "invite") {
    return NextResponse.redirect(new URL("/login?invite=invalid", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" });
  if (error) return NextResponse.redirect(new URL("/login?invite=expired", url.origin));
  return NextResponse.redirect(destination);
}

