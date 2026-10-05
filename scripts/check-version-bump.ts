// Fails unless package.json's version is higher than the base branch's.
// Every merge to main deploys, and every deploy gets its own version.
//   bun scripts/check-version-bump.ts <base package.json>
const [basePath] = process.argv.slice(2);
if (!basePath) throw new Error("usage: bun scripts/check-version-bump.ts <base package.json>");

const base: string = (await Bun.file(basePath).json()).version;
const head: string = (await Bun.file("package.json").json()).version;

if (Bun.semver.order(head, base) !== 1) {
  console.error(
    `Version ${head} is not higher than main's ${base}. Bump it in this PR:\n` +
      `  bun pm version patch --no-git-tag-version   (fixes)\n` +
      `  bun pm version minor --no-git-tag-version   (new features)\n` +
      `  bun pm version major --no-git-tag-version   (breaking changes, e.g. saved data old versions can't read)`,
  );
  process.exit(1);
}
console.log(`Version bump OK: ${base} -> ${head}`);
