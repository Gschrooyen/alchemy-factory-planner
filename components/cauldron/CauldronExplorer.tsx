"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { buildCauldronTable, recipeAt, NO_THIRD, type CauldronKind, type CauldronTable } from "@/lib/cauldron";
import { CauldronRows } from "./CauldronRows";
import { useFactoryStore } from "@/store/useFactoryStore";
import { attributeMultiplier } from "@/engine/attributes";

type SortKey = "output" | "rate";

const PAGE = 300;
const selectClass =
  "px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold-dim)] transition-colors cursor-pointer";

export function CauldronExplorer({ kind }: { kind: CauldronKind }) {
  const [table, setTable] = useState<CauldronTable | null>(null);
  const [search, setSearch] = useState("");
  const [output, setOutput] = useState("");
  const [sort, setSort] = useState<SortKey>("output");
  const [desc, setDesc] = useState(false);
  const [group, setGroup] = useState(true);
  const [limit, setLimit] = useState(PAGE);
  // Cauldrons tick with the same machine-speed factor as every other facility
  const factoryLevel = useFactoryStore((s) => s.research.factoryEfficiency);
  const speed = attributeMultiplier("FactorySpeed", factoryLevel);

  // Basic pot is ~830k rows in ~300ms; build after mount so the page paints first
  useEffect(() => {
    const id = setTimeout(() => setTable(buildCauldronTable(kind)), 0);
    return () => clearTimeout(id);
  }, [kind]);

  const rows = useMemo(() => {
    if (!table) return new Uint32Array(0);
    const { inputs, outputs, size, i, j, k, out } = table;

    // Every search term must match one ingredient or the output; precompute per item
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const inMatch = terms.map((t) => inputs.map((x) => x.name.toLowerCase().includes(t)));
    const outMatch = terms.map((t) => outputs.map((x) => x.name.toLowerCase().includes(t)));
    const outFilter = output ? outputs.findIndex((o) => o.id === output) : -1;

    const keep = new Uint32Array(size);
    let n = 0;
    for (let r = 0; r < size; r++) {
      const third = k[r] !== NO_THIRD;
      if (outFilter >= 0 && out[r] !== outFilter) continue;
      let ok = true;
      for (let t = 0; t < terms.length && ok; t++) {
        ok = outMatch[t][out[r]] || inMatch[t][i[r]] || inMatch[t][j[r]] || (third && inMatch[t][k[r]]);
      }
      if (ok) keep[n++] = r;
    }
    const result = keep.subarray(0, n);

    // Grouping is just a stable sort by output first
    const outName = outputs.map((o) => o.name);
    const key = (r: number): number => {
      switch (sort) {
        case "rate": return -outputs[out[r]].ct; // time and heat grow with the target, so rate falls
        default: return 0;
      }
    };
    const dir = desc ? -1 : 1;
    result.sort((a, b) => {
      if (group || sort === "output") {
        const c = outName[out[a]].localeCompare(outName[out[b]]);
        if (c !== 0) return sort === "output" ? c * dir : c;
      }
      return (key(a) - key(b)) * dir || a - b;
    });
    return result;
  }, [table, search, output, sort, desc, group]);

  useEffect(() => setLimit(PAGE), [search, output, sort, desc, group]);

  if (!table) {
    return <div className="py-12 text-center text-[var(--text-muted)]">Brewing every combination…</div>;
  }

  const visible = Array.from(rows.subarray(0, limit), (r) => recipeAt(table, r, speed));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ingredients or output… (space-separate several)"
            className="w-full pl-10 pr-10 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-gold-dim)] transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <select value={output} onChange={(e) => setOutput(e.target.value)} className={selectClass}>
          <option value="">Any output</option>
          {table.outputs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
          <option value="output">Sort: output</option>
          <option value="rate">Sort: rate</option>
        </select>

        <button onClick={() => setDesc((d) => !d)} className={selectClass} title="Toggle direction">
          {desc ? "↓ desc" : "↑ asc"}
        </button>

        <label className={`${selectClass} flex items-center gap-2`}>
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} className="accent-[var(--accent-gold)]" />
          Group by output
        </label>
      </div>

      <div className="text-sm text-[var(--text-muted)]">
        {rows.length.toLocaleString()} of {table.size.toLocaleString()} combinations
        {rows.length > limit && <span className="ml-2">· showing first {limit.toLocaleString()}</span>}
        <span className="ml-2">· times at Factory Eff {factoryLevel} ({Math.round(speed * 100)}% speed)</span>
      </div>

      <CauldronRows recipes={visible} grouped={group} />

      {rows.length > limit && (
        <button
          onClick={() => setLimit((l) => l + PAGE * 4)}
          className="self-center px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-gold-dim)] transition-colors"
        >
          Show more
        </button>
      )}
    </div>
  );
}
