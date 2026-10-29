import Link from "next/link";

export default async function SetupPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const needsEnvironment = reason === "environment";
  return <main className="auth-shell"><section className="auth-card setup-card">
    <Link className="brand auth-brand" href="/"><span className="brand-mark">M</span><span>MvendyWendy</span></Link>
    <p className="eyebrow auth-eyebrow">ONE-TIME SETUP</p>
    <h1>{needsEnvironment ? "Connect your studio" : "Finish workspace setup"}</h1>
    <p className="auth-subtitle">{needsEnvironment ? "Add your Supabase project settings to connect sign-in and the studio database." : "Your account is signed in, but it isn’t linked to a studio yet."}</p>
    <div className="setup-steps">
      <div><span>1</span><p>Create <code>.env.local</code> from <code>.env.example</code>, then add your project URL and publishable key.</p></div>
      <div><span>2</span><p>Run the SQL migrations from <strong>Supabase → SQL Editor</strong>: membership, customers and measurements, orders and production, manual payments, production assignments, then team management. Paystack setup is separate and can wait until you register.</p></div>
      <div><span>3</span><p>Create the first business and owner membership using the SQL in the project README.</p></div>
    </div>
    <p className="auth-help">Keep secret and service-role keys out of the browser and GitHub.</p>
    <Link className="text-link setup-back" href="/login">Back to sign in <span>→</span></Link>
  </section></main>;
}
