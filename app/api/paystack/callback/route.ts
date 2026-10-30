import { NextResponse } from "next/server";
import { recordVerifiedPayment, verifyPaystack } from "@/lib/paystack";
export async function GET(request: Request) {
  const url = new URL(request.url); const ref = url.searchParams.get("reference") ?? url.searchParams.get("trxref");
  if (!ref) return NextResponse.redirect(new URL("/payments?payment=missing", url.origin));
  try {
    const payment = await verifyPaystack(ref);
    if (!payment || payment.reference !== ref) return NextResponse.redirect(new URL("/payments?payment=pending", url.origin));
    await recordVerifiedPayment(payment);
    return NextResponse.redirect(new URL("/payments?payment=confirmed", url.origin));
  } catch { return NextResponse.redirect(new URL("/payments?payment=verify-error", url.origin)); }
}
