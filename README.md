# MvendyWendy Fashion Studio

A web application for fashion studio operations. The current build includes the owner dashboard, email and password sign-in, protected dashboard routing, customer records, reusable measurement history, garment orders, production stages, schedule changes, and fulfilment tracking. Supabase migrations define tenant membership, customer access policies, and auditable order workflows.

## Run locally

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Connect your Supabase project

1. Copy `.env.example` to `.env.local`.
2. In Supabase project settings, copy the Project URL and publishable key into `.env.local`:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

3. Restart the development server after saving `.env.local`.
4. In Supabase Authentication, create the owner user. Public sign-up is not exposed by this app; owner and staff accounts should be created or invited through controlled admin workflows.
5. In the Supabase SQL Editor, run `supabase/migrations/202610290001_initial_business_membership.sql`, then `supabase/migrations/202610290002_customers_measurements.sql`, then `supabase/migrations/202610290003_orders_production.sql`.
6. Open `supabase/setup-first-owner.sql`, replace `replace-with-owner-email@example.com` with the owner's Supabase Auth email, then run it in the SQL Editor. This creates the MvendyWendy business and owner membership.

The dashboard and customer directory redirect unauthenticated visitors to sign-in and users without an active business membership to the setup page. Owners and supervisors can create, search, edit, and archive customers, and record dated measurement sessions with configurable fields in centimetres or inches. Measurement history is retained when a customer is archived.

Orders support multiple garments, a linked measurement session, production-stage updates, audited schedule changes, and separate planned and actual fulfilment dates. Price records are restricted to owners and supervisors. Payment recording and a team assignment interface remain in the next implementation slice.

## Security notes

- `.env.local` is ignored by Git. Never commit secrets.
- The publishable key is intended for browser use; database access is constrained by Row Level Security.
- Never put a Supabase secret or service-role key in a `NEXT_PUBLIC_` variable or in browser code.
- The initial migration grants clients read access only to businesses and memberships visible to the signed-in user. All other writes are denied until their workflows and policies are implemented.

## Roadmap

1. Authentication, business membership, and protected owner workspace
2. Customer records and measurement history
3. Orders, production tracking, and fulfilment
4. Payments, fulfilment, reports, and audit history




