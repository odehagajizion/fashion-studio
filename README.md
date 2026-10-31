# MvendyWendy Fashion Studio

A web application for fashion studio operations. The current build includes the owner dashboard, email and password sign-in, protected dashboard routing, customer records, reusable measurement history, garment orders, production stages, schedule changes, fulfilment tracking, and audited tailor assignments. Supabase migrations define tenant membership, customer access policies, and auditable order workflows.

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
5. In the Supabase SQL Editor, run `supabase/migrations/202610290001_initial_business_membership.sql`, then `supabase/migrations/202610290002_customers_measurements.sql`, then `supabase/migrations/202610290003_orders_production.sql`, then `supabase/migrations/202610290004_manual_payments.sql`, then `supabase/migrations/202610290005_production_assignments.sql`, then `supabase/migrations/202610290007_team_management.sql`, then `supabase/migrations/202610290008_team_invitations.sql`, then `supabase/migrations/202610290009_expenses.sql`. The Paystack checkout migration is separate and can be applied when you are ready to configure the gateway.
6. Open `supabase/setup-first-owner.sql`, replace `replace-with-owner-email@example.com` with the owner's Supabase Auth email, then run it in the SQL Editor. This creates the MvendyWendy business and owner membership.

## Add team members

Owners can invite supervisors or tailors from the Team workspace. Set SUPABASE_SERVICE_ROLE_KEY in .env.local and the hosting provider, and keep it server-side. In Supabase Auth, allow the app URL plus /auth/confirm in the redirect list. Update the Invite user email template so its link targets /auth/confirm with token_hash and type=invite. The app verifies the token server-side and asks the member to set a password. Configure a custom SMTP sender before inviting real staff. Supabase default email can send only to your organization members and is limited to two messages per hour.

The Orders workspace lists active team members and lets owners or supervisors assign and remove production assignments. Assignment changes are retained in order activity history. The add-team-member SQL remains available for controlled manual linking when needed.

Orders support multiple garments, a linked measurement session, production-stage updates, audited schedule changes, and separate planned and actual fulfilment dates. Price and payment records are restricted to owners and supervisors. Manual receipts are append-only, balances are calculated from order lines and payment adjustments, and refunds or reversals are recorded as separate audit entries. Gateway reconciliation remains future work. Staff invitations use Supabase Auth with owner-only role assignment. Existing active supervisors and tailors can be assigned to orders.

The owner-only Team workspace lists linked accounts and lets you change supervisor or tailor roles, pause access, and restore access. Pausing a member clears their active order assignments and records the changes in an audit table. New user invitations use the owner-only Team workspace and Supabase Auth.

The owner-only Expenses workspace records dated studio costs by category, optionally links them to an order, and supports private receipt photos. Expense edits are audited. Reports distinguish cash received minus expenses from estimated order gross profit (order value minus costs tagged to that order); unlinked expenses are treated as operating costs.

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

## Paystack online payments

Apply the Supabase migration `supabase/migrations/202610290006_paystack_checkout.sql` before using online checkout. Add these server environment variables to local `.env.local` and your hosting provider (keep both secrets private):

- `PAYSTACK_SECRET_KEY` — a Paystack test secret key during development; replace it with the live key when ready for real charges.
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase project service-role secret, used only by server API routes.
- `NEXT_PUBLIC_SITE_URL` — the public app origin, such as `http://localhost:3000` locally.

Set the Paystack webhook URL in the Paystack dashboard to `https://YOUR_APP_HOST/api/paystack/webhook`. The customer record for an order needs an email address. In Payments, choose the order and amount, then select **Pay online with Paystack**. The callback and webhook both verify the transaction with Paystack before the receipt is added to the payment ledger.
