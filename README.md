# Alchemy Factory Planner (fork)

> **This is a fork of [moldy530/alchemy-factory-planner](https://github.com/moldy530/alchemy-factory-planner).**
> All credit for the original planner, codex and design goes to [@moldy530](https://github.com/moldy530).
> The official site is [alchemyfactorytools.com](https://alchemyfactorytools.com).

A production planner and calculator for the Steam game [Alchemy Factory](https://store.steampowered.com/app/2708770/Alchemy_Factory/).

## What this fork adds

- ELK-based graph layout and a list view, with machines you can tick off as built
- LP-based planner fixes: whole-machine optimization, supplied resources, external fuel/fertilizer
- Cauldron brew solver, recipe pins, plan sharing
- Optional accounts: servers (game worlds with their own skills) holding factories, synced across devices
- Recipe data corrections checked against game data

## Development

```bash
bun install
bun run dev    # http://localhost:3000
bun run build
```

## Deploying

Import the repo on [Vercel](https://vercel.com); no configuration is needed. Without Supabase (below) the app runs local-only: everything is saved in the browser and the sign-in button is hidden.

- `NEXT_PUBLIC_SITE_URL` (optional): your custom domain, used for canonical/OpenGraph/sitemap URLs. Defaults to the Vercel production URL.

Feedback opens a pre-filled issue on this repo, so keep GitHub Issues enabled.

## Accounts (optional)

Signing in syncs a user's servers and factories across devices. It uses [Supabase](https://supabase.com) for auth and the database.

1. Add Supabase to the Vercel project: `vercel integration add supabase -m region=fra1`. This sets `NEXT_PUBLIC_SUPABASE_URL`, the keys and `POSTGRES_URL`. Run `vercel env pull` for local dev.
2. Run [`supabase/schema.sql`](supabase/schema.sql) once in the Supabase SQL editor. It creates the `servers` and `factories` tables, the row-level security that keeps users to their own data, and `delete_my_account()`.
3. In Supabase → Authentication → URL Configuration, set the Site URL to your domain and add `https://<your-domain>/**` and `http://localhost:3000/**` as redirect URLs.
4. Enable providers under Authentication → Providers. Email links work out of the box. For Google and GitHub, create an OAuth client with the callback `https://<project-ref>.supabase.co/auth/v1/callback`.

After any schema change, check that accounts are still isolated:

```bash
bun --env-file=.env.local supabase/isolation-check.ts
```

It creates two throwaway users, tries to read, change and delete across accounts, and exits non-zero if anything gets through.
