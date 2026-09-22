import Link from "next/link";
import { Fragment } from "react";
import type { CauldronRecipe } from "@/lib/cauldron";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

/** "Diamond + Diamond" becomes one entry consumed twice per brew. */
function collapse(inputs: CauldronRecipe["inputs"]) {
  const out: { item: CauldronRecipe["inputs"][number]; count: number }[] = [];
  for (const item of inputs) {
    const prev = out.find((e) => e.item.id === item.id);
    if (prev) prev.count++;
    else out.push({ item, count: 1 });
  }
  return out;
}

export function CauldronRows({ recipes, grouped }: { recipes: CauldronRecipe[]; grouped: boolean }) {
  if (recipes.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]">
        <p className="text-lg">No combinations found</p>
        <p className="text-sm mt-1">Try fewer search terms</p>
      </div>
    );
  }

  let lastOutput = "";
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm">
        <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="text-left px-3 py-2">Inputs (per cauldron, /min)</th>
            <th className="text-left px-3 py-2">Output (/min)</th>
            <th className="text-right px-3 py-2">Brew time</th>
            <th className="text-right px-3 py-2">Heat</th>
          </tr>
        </thead>
        <tbody>
          {recipes.map((r, idx) => {
            const header = grouped && r.output.id !== lastOutput;
            lastOutput = r.output.id;
            return (
              <Fragment key={idx}>
                {header && (
                  <tr className="bg-[var(--surface-elevated)]">
                    <td colSpan={4} className="px-3 py-1.5 font-cinzel text-[var(--accent-gold)]">
                      <Link href={`/items/${r.output.id}`} className="hover:underline">{r.output.name}</Link>
                    </td>
                  </tr>
                )}
                <tr className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface)]/60">
                  <td className="px-3 py-1.5 text-[var(--text-primary)]">
                    {collapse(r.inputs).map(({ item, count }, n) => (
                      <Fragment key={n}>
                        {n > 0 && <span className="text-[var(--text-muted)]"> + </span>}
                        <Link href={`/items/${item.id}`} className="hover:text-[var(--accent-gold)]">{item.name}</Link>
                        <span className="text-[var(--accent-gold)] tabular-nums"> {fmt((60 * count) / r.time)}</span>
                      </Fragment>
                    ))}
                  </td>
                  <td className="px-3 py-1.5 text-[var(--accent-purple)] whitespace-nowrap">
                    {r.output.name}
                    <span className="text-[var(--accent-gold)] tabular-nums"> {fmt(60 / r.time)}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right text-[var(--text-secondary)] tabular-nums">{fmt(r.time)}s</td>
                  <td className="px-3 py-1.5 text-right text-[var(--text-secondary)] tabular-nums">{fmt(r.heat)}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
