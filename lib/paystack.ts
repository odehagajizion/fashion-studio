import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function paystackSecret() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Paystack is not configured. Add PAYSTACK_SECRET_KEY.");
  return key;
}
export function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Payment service is not configured.");
  return createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function verifyPaystack(reference: string) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${paystackSecret()}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not verify payment with Paystack.");
  const payload = await response.json();
  if (!payload.status || payload.data?.status !== "success") return null;
  return payload.data as { reference: string; amount: number; currency: string; id: number | string; status: string };
}
export function validPaystackSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const expected = createHmac("sha512", paystackSecret()).update(rawBody).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "hex"); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export async function recordVerifiedPayment(data: { reference: string; amount: number; currency: string; id: number | string }) {
  const { error } = await adminSupabase().rpc("complete_paystack_checkout", {
    p_reference: data.reference, p_amount_kobo: data.amount, p_currency: data.currency, p_transaction_id: String(data.id),
  });
  if (error) throw new Error("Verified payment could not be added to the ledger.");
}

