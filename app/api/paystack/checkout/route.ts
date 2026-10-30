import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { paystackSecret } from "@/lib/paystack";
export async function POST(request: Request) {
  try {
    const { orderId, amount } = await request.json();
    if (typeof orderId !== "string" || !Number.isFinite(Number(amount)) || Number(amount) <= 0) return NextResponse.json({ error: "Choose an order and enter a valid amount." }, { status: 400 });
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims?.sub) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
    const { data, error } = await supabase.rpc("create_paystack_checkout_request", { p_order_id: orderId, p_amount: Number(amount) });
    if (error || !data?.length) return NextResponse.json({ error: error?.message ?? "Could not reserve checkout." }, { status: 400 });
    const item = data[0]; const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    const response = await fetch("https://api.paystack.co/transaction/initialize", { method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: item.customer_email, amount: String(Math.round(Number(item.amount) * 100)), currency: "NGN", reference: item.reference,
        callback_url: `${siteUrl}/api/paystack/callback`, metadata: { checkout_request_id: item.request_id, order_id: orderId } }), cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.authorization_url) return NextResponse.json({ error: "Paystack could not start checkout. Try again shortly." }, { status: 502 });
    return NextResponse.json({ authorizationUrl: result.data.authorization_url });
  } catch { return NextResponse.json({ error: "Checkout could not be started. Confirm server payment settings." }, { status: 500 }); }
}
