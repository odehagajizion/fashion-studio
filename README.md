# MvendyWendy Fashion Studio

A web application for fashion studio operations. The current build includes the owner dashboard, email and password sign-in, server-side session refresh, protected dashboard routing, and the first Supabase business-membership migration.

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
5. In the Supabase SQL Editor, run `supabase/migrations/202610290001_initial_business_membership.sql`.
6. Open `supabase/setup-first-owner.sql`, replace `replace-with-owner-email@example.com` with the owner's Supabase Auth email, then run it in the SQL Editor. This creates the MvendyWendy business and owner membership.

The dashboard redirects unauthenticated visitors to sign-in and users without an active business membership to the setup page.

## Security notes

- `.env.local` is ignored by Git. Never commit secrets.
- The publishable key is intended for browser use; database access is constrained by Row Level Security.
- Never put a Supabase secret or service-role key in a `NEXT_PUBLIC_` variable or in browser code.
- The initial migration grants clients read access only to businesses and memberships visible to the signed-in user. All other writes are denied until their workflows and policies are implemented.

## Roadmap

1. Authentication, business membership, and protected owner workspace
2. Customer records and measurement history
3. Orders and production tracking
4. Payments, fulfilment, reports, and audit history
