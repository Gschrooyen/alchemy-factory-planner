"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { getParadoxInputs, paradoxBatchTime, paradoxProductId, PARADOX_HEAT } from "@/lib/paradox";
import { getItem } from "@/engine/item-utils";
import { useFactoryStore } from "@/store/useFactoryStore";
import { attributeMultiplier } from "@/engine/attributes";

type SortKey = "time" | "cost" | "name";
const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { maximumFractionDigits: d });
const selectClass =
  "px-3 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold-dim)] transition-colors cursor-pointer";

export function ParadoxExplorer() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("time");
  const [batch, setBatch] = useState(1);
  const factoryLevel = useFactoryStore((s) => s.research.factoryEfficiency);
  const speed = attributeMultiplier("FactorySpeed", factoryLevel);
  const inputs = useMemo(() => getParadoxInputs(), []);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    const list = inputs
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .map((i) => {
        const time = paradoxBatchTime(i.id, i.cc, batch) / speed;
        const productId = paradoxProductId(i.id);
        return {
          ...i,
          productId,
          productName: getItem(productId)?.name ?? productId,
          time,
          inRate: (60 / time) * batch, // units eaten per minute
          outRate: 60 / time, // one product per batch
        };
      });
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "cost") return b.cc - a.cc;
      return a.time - b.time || a.name.localeCompare(b.name);
    });
    return list;
  }, [inputs, search, sort, batch, speed]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search input item…"
            className="w-full pl-10 pr-10 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-gold-dim)] transition-colors"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <label
          className={`${selectClass} flex items-center gap-2`}
          title="How many units are in the input slot when the crucible grabs a batch. One at a time gives the best yield."
        >
          Batch size
          <input
            type="number"
            min={1}
            max={600}
            value={batch}
            onChange={(e) => setBatch(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-16 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded px-2 py-0.5 text-xs text-[var(--text-secondary)]"
          />
        </label>

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
          <option value="time">Sort: fastest</option>
          <option value="cost">Sort: cauldron cost</option>
          <option value="name">Sort: name</option>
        </select>
      </div>

      <div className="text-sm text-[var(--text-muted)]">
        {rows.length} inputs · batch of {batch} → 1 output · times at Factory Eff {factoryLevel} ({Math.round(speed * 100)}% speed)
        · {fmt(PARADOX_HEAT, 0)} heat/s while brewing
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            <tr>
              <th className="text-left px-3 py-2">Input</th>
              <th className="text-right px-3 py-2">Cauldron cost</th>
              <th className="text-right px-3 py-2">Batch time</th>
              <th className="text-right px-3 py-2">Input /min</th>
              <th className="text-left px-3 py-2">Output</th>
              <th className="text-right px-3 py-2">Output /min</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-subtle)] hover:bg-[var(--surface)]/60">
                <td className="px-3 py-1.5 text-[var(--text-primary)]">
                  <Link href={`/items/${r.id}`} className="hover:text-[var(--accent-gold)]">{r.name}</Link>
                </td>
                <td className="px-3 py-1.5 text-right text-[var(--text-secondary)] tabular-nums">{fmt(r.cc, 2)}</td>
                <td className="px-3 py-1.5 text-right text-[var(--text-secondary)] tabular-nums">{fmt(r.time, r.time < 1 ? 2 : 1)}s</td>
                <td className="px-3 py-1.5 text-right text-[var(--accent-gold)] tabular-nums">{fmt(r.inRate, 2)}</td>
                <td className="px-3 py-1.5 text-[var(--accent-purple)] whitespace-nowrap">
                  <Link href={`/items/${r.productId}`} className="hover:underline">{r.productName}</Link>
                </td>
                <td className="px-3 py-1.5 text-right text-[var(--accent-gold)] tabular-nums">{fmt(r.outRate, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
