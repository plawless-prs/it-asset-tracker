**PRS Apps** — internal tool hub for Power & Rubber Supply, deployed at [prstech.app](https://www.prstech.app). Next.js (App Router) + Supabase, deployed on Vercel. See [`AGENTS.md`](./AGENTS.md) for the architecture and conventions.

## Setting up on a new machine

1. **Install prerequisites:** Git and Node.js **24.x** (this repo is developed on v24.14.0; npm 11 ships with it).
2. **Clone and install:**
   ```bash
   git clone <repo-url> it-asset-tracker
   cd it-asset-tracker
   npm install
   ```
3. **Create `.env.local`:** secrets are gitignored and don't travel with the repo. Copy `.env.example` to `.env.local` and fill it in, or pull the full set from Vercel:
   ```bash
   vercel link
   vercel env pull .env.local
   ```
   The two `NEXT_PUBLIC_SUPABASE_*` keys are enough for most front-end work; the rest are only needed for server routes (email/Graph, service-role). See `.env.example` for the full list.
4. **Run it:** `npm run dev`, then open [http://localhost:3000](http://localhost:3000).

> Note: local dev talks to the **live** Supabase and Vercel project — there's no local database. You're reading/writing real data, so be careful. Migrations in `supabase/` are already applied there; only run new ones (see [`supabase/README.md`](./supabase/README.md)).

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
