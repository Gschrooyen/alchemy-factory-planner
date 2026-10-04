# Alchemy Factory Planner (fork)

> **This is a fork of [moldy530/alchemy-factory-planner](https://github.com/moldy530/alchemy-factory-planner).**
> All credit for the original planner, codex and design goes to [@moldy530](https://github.com/moldy530).
> The official site is [alchemyfactorytools.com](https://alchemyfactorytools.com).

A production planner and calculator for the Steam game [Alchemy Factory](https://store.steampowered.com/app/2708770/Alchemy_Factory/).

## What this fork adds

- ELK-based graph layout and a list view, with machines you can tick off as built
- LP-based planner fixes: whole-machine optimization, supplied resources, external fuel/fertilizer
- Cauldron brew solver, recipe pins, plan sharing
- Recipe data corrections checked against game data

## Development

```bash
bun install
bun run dev    # http://localhost:3000
bun run build
```

## Deploying

Import the repo on [Vercel](https://vercel.com); no configuration is needed.

- `NEXT_PUBLIC_SITE_URL` (optional): your custom domain, used for canonical/OpenGraph/sitemap URLs. Defaults to the Vercel production URL.
- `DISCORD_WEBHOOK_URL` (optional): where the in-app feedback form posts. Without it, feedback returns an error.
