import { NextResponse } from "next/server";
import { recordVerifiedPayment, validPaystackSignature, verifyPaystack } from "@/lib/paystack";
export async function POST(request: Request) {
  const raw = await request.text();
  try {
    if (!validPaystackSignature(raw, request.headers.get("x-paystack-signature"))) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    const event = JSON.parse(raw);
    if (event.event !== "charge.success" || typeof event.data?.reference !== "string") return NextResponse.json({ received: true });
    const payment = await verifyPaystack(event.data.reference);
    if (!payment || payment.reference !== event.data.reference) return NextResponse.json({ received: true });
    await recordVerifiedPayment(payment);
    return NextResponse.json({ received: true });
  } catch { return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 }); }
}
