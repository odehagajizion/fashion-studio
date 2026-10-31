import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function toWhatsAppPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `234${digits.slice(1)}`;
  if (digits.length < 8 || digits.length > 15) throw new Error("The customer phone number is not valid for WhatsApp.");
  return digits;
}

function studioContactPhone() {
  const configured = process.env.NEXT_PUBLIC_STUDIO_WHATSAPP_PHONE?.trim();
  if (!configured) return "+234XXXXXXXXXX";
  try { return `+${toWhatsAppPhone(configured)}`; } catch { return configured; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims?.sub) return NextResponse.json({ error: "Sign in to send an order update." }, { status: 401 });

    const { data: membership } = await supabase.from("business_memberships").select("business_id, role")
      .eq("user_id", auth.claims.sub).eq("is_active", true).maybeSingle();
    if (!membership || !["owner", "supervisor"].includes(membership.role)) return NextResponse.json({ error: "Owner or supervisor access is required." }, { status: 403 });

    const { data: order, error: orderError } = await supabase.from("orders")
      .select("id, business_id, customer_id, order_ref, stage, fulfillment_method")
      .eq("id", orderId).eq("business_id", membership.business_id).maybeSingle();
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (order.stage !== "ready_for_pickup") return NextResponse.json({ error: "WhatsApp updates are available when an order is ready." }, { status: 409 });

    const [customerResult, itemResult, paymentResult, discountResult, expressResult] = await Promise.all([
      supabase.from("customers").select("first_name, last_name, phone").eq("id", order.customer_id).eq("business_id", membership.business_id).maybeSingle(),
      supabase.from("order_items").select("id, quantity").eq("order_id", order.id).eq("business_id", membership.business_id),
      supabase.from("payments").select("id, amount").eq("order_id", order.id).eq("business_id", membership.business_id),
      supabase.from("order_voucher_discounts").select("discount_amount").eq("order_id", order.id).eq("business_id", membership.business_id).maybeSingle(),
      supabase.from("order_express_charges").select("amount").eq("order_id", order.id).eq("business_id", membership.business_id).maybeSingle(),
    ]);
    const customer = customerResult.data;
    if (customerResult.error || !customer) return NextResponse.json({ error: "Customer details could not be loaded." }, { status: 404 });
    const items = itemResult.data ?? [];
    const itemIds = items.map(item => item.id);
    const priceResult = itemIds.length
      ? await supabase.from("order_item_prices").select("order_item_id, unit_price").eq("business_id", membership.business_id).in("order_item_id", itemIds)
      : { data: [], error: null };
    if (itemResult.error || paymentResult.error || discountResult.error || expressResult.error || priceResult.error) return NextResponse.json({ error: "Order balance could not be calculated." }, { status: 500 });

    const priceByItem = new Map((priceResult.data ?? []).map(row => [row.order_item_id, Number(row.unit_price)]));
    const subtotal = items.reduce((sum, item) => sum + item.quantity * (priceByItem.get(item.id) ?? 0), 0);
    const total = Math.max(0, subtotal - Number(discountResult.data?.discount_amount ?? 0)) + Number(expressResult.data?.amount ?? 0);
    const payments = paymentResult.data ?? [];
    const paymentIds = payments.map(payment => payment.id);
    const adjustmentResult = paymentIds.length
      ? await supabase.from("payment_adjustments").select("amount").eq("business_id", membership.business_id).in("payment_id", paymentIds)
      : { data: [], error: null };
    if (adjustmentResult.error) return NextResponse.json({ error: "Order balance could not be calculated." }, { status: 500 });
    const received = payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      - (adjustmentResult.data ?? []).reduce((sum, adjustment) => sum + Number(adjustment.amount), 0);
    const balance = Math.max(0, total - received);
    const balanceText = balance > 0
      ? `Outstanding balance: ${new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(balance)}`
      : "Your order is fully paid";
    const statusNotice = order.fulfillment_method === "delivery"
      ? "is out for delivery!"
      : "is ready for pickup!";
    const studioAddress = process.env.NEXT_PUBLIC_STUDIO_ADDRESS?.trim() || "[Studio Address / Location]";
    const customerPhone = toWhatsAppPhone(customer.phone);
    const message = `Hello ${customer.first_name} ${customer.last_name},\n\nYour order #${order.order_ref} at MvendyWendy Fashion Studio ${statusNotice}\n${balanceText}\n\n---\nMvendyWendy Fashion Studio\n📞 WhatsApp/Call: ${studioContactPhone()}\n📍 ${studioAddress}\nThank you for your patronage!`;
    const whatsappUrl = `https://wa.me/${customerPhone}?text=${encodeURIComponent(message)}`;
    return NextResponse.redirect(whatsappUrl, { status: 302 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare the WhatsApp update." }, { status: 500 });
  }
}
