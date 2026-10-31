import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function whatsappPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("The customer phone number is not valid for WhatsApp.");
  return digits.startsWith("0") ? `234${digits.slice(1)}` : digits;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.orderId !== "string") return NextResponse.json({ error: "Choose a completed order." }, { status: 400 });
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims?.sub) return NextResponse.json({ error: "Sign in to create a voucher link." }, { status: 401 });
    const { data, error } = await supabase.rpc("get_or_create_order_voucher", { p_order_id: body.orderId });
    const voucher = Array.isArray(data) ? data[0] : data;
    if (error || !voucher) return NextResponse.json({ error: error?.message ?? "Could not create a voucher." }, { status: 400 });
    if (voucher.status !== "active" || new Date(voucher.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: "This order’s voucher has already been used or has expired." }, { status: 409 });
    const phone = whatsappPhone(String(voucher.customer_phone ?? ""));
    const expiry = new Date(voucher.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
    const studioPhone = process.env.NEXT_PUBLIC_STUDIO_WHATSAPP_PHONE?.trim() || "+234XXXXXXXXXX";
    const studioAddress = process.env.NEXT_PUBLIC_STUDIO_ADDRESS?.trim() || "[Studio Address / Location]";
    const message = `Hello ${voucher.customer_name},\n\nThank you for choosing MvendyWendy Fashion Studio for order #${voucher.order_ref}! It was a pleasure creating your garments.\n\nAs a token of our appreciation, here is a ${voucher.discount_percentage}% discount voucher for your next custom order or alteration. Simply mention code ${voucher.code} or show this message when you book your next consultation. This voucher is valid until ${expiry}.\n\nWe’d love to see how it fits—tag us or share a photo with us here!\n\nWarm regards,\nMvendyWendy Fashion Studio\n📞 ${studioPhone}\n📍 ${studioAddress}`;
    return NextResponse.json({ whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create the WhatsApp link." }, { status: 500 });
  }
}
