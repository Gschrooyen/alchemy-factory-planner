// NEXT_PUBLIC_SITE_URL wins (custom domain); otherwise Vercel's production URL, then local dev.
const host =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/^https?:\/\//, "") ??
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  "localhost:3000";

export const SITE_HOST = host;
export const SITE_URL = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;

export const MAINTAINER = { name: "Gschrooyen", url: "https://github.com/Gschrooyen" };
export const REPO_URL = "https://github.com/Gschrooyen/alchemy-factory-planner";
export const UPSTREAM = {
  name: "moldy530",
  url: "https://github.com/moldy530",
  repo: "https://github.com/moldy530/alchemy-factory-planner",
};
