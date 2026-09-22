"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Infinity as InfinityIcon, RotateCcw, Search, X } from "lucide-react";
import { getParadoxInputs, paradoxBatchTime, paradoxProductId } from "@/lib/paradox";
import { getItem, normalizeItemId } from "@/engine/item-utils";
import { getRecipeById } from "@/engine/lp-planner/model-builder";
import type { ProductionNode } from "@/engine/types";
import { useFactoryStore } from "@/store/useFactoryStore";

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 2 : 1 });

/** Small button on a Mors/Vitae node: pick what to feed the Paradox Crucible. LP only. */
export function ParadoxSwapButton({ node }: { node: ProductionNode }) {
  const [open, setOpen] = useState(false);
  const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
  const factory = factories.find((f) => f.id === activeFactoryId);
  const itemId = normalizeItemId(node.itemName);
  const item = getItem(itemId);
  if (!factory || factory.plannerMode !== "lp" || !item || (itemId !== "mors" && itemId !== "vitae")) return null;

  // A solver-chosen paradox brew has no override; read its input off the node's recipe
  const solverInput = node.recipeId?.startsWith("auto:paradox") ? getRecipeById(node.recipeId)?.inputs[0] : undefined;
  const solverInputId = solverInput ? (solverInput.id ?? normalizeItemId(solverInput.name)) : undefined;
  const active = !!factory.config.paradoxOverrides?.[itemId];
  const choose = (inputId: string | null) => {
    const { [itemId]: _, ...rest } = factory.config.paradoxOverrides ?? {};
    updateFactoryConfig(factory.id, { paradoxOverrides: inputId ? { ...rest, [itemId]: inputId } : rest });
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className={`nodrag ${active || solverInputId ? "text-[var(--accent-gold)]" : "text-[var(--text-muted)] hover:text-[var(--accent-gold)]"}`}
        title={active ? "Paradox Crucible input (click to change)" : solverInputId ? "Input chosen by the solver (click to pin or change)" : "Choose the Paradox Crucible input…"}
        onClick={() => setOpen(true)}
      >
        <InfinityIcon size={12} />
      </button>
      {active && (
        <button type="button" className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-gold)]" title="Back to normal recipes" onClick={() => choose(null)}>
          <RotateCcw size={10} />
        </button>
      )}
      {open && (
        <ParadoxPicker itemId={itemId} itemName={item.name} current={factory.config.paradoxOverrides?.[itemId] ?? solverInputId} onChoose={choose} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ParadoxPicker({ itemId, itemName, current, onChoose, onClose }: {
  itemId: string; itemName: string; current?: string; onChoose: (id: string | null) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return getParadoxInputs()
      .filter((i) => paradoxProductId(i.id) === itemId && (!q || i.name.toLowerCase().includes(q)))
      .map((i) => ({ ...i, time: paradoxBatchTime(i.id, i.cc, 1) }))
      .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  }, [itemId, search]);

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-xl max-h-[85vh] flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-cinzel text-lg text-[var(--accent-gold)] flex items-center gap-2">
            <InfinityIcon size={18} /> {itemName} from the Paradox Crucible
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Pick the input. One unit per batch (best yield); the planner re-plans upstream to make it.
        </p>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by input…"
              className="w-full pl-10 pr-3 py-2 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold-dim)]"
            />
          </div>
          {current && (
            <button onClick={() => onChoose(null)} className="px-3 py-2 bg-[var(--background-deep)] border border-[var(--accent-gold-dim)] rounded-lg text-sm text-[var(--accent-gold)] hover:bg-[var(--surface-elevated)]">
              Back to normal recipes
            </button>
          )}
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1 rounded-lg border border-[var(--border-subtle)]">
          {rows.map((r) => (
            <div key={r.id} className={`flex items-center justify-between gap-3 px-3 py-1.5 text-sm border-b border-[var(--border-subtle)] ${current === r.id ? "bg-[var(--accent-gold)]/10" : "hover:bg-[var(--surface-elevated)]"}`}>
              <span className="text-[var(--text-primary)]">
                {r.name}
                <span className="ml-2 text-xs text-[var(--text-muted)]">{fmt(r.time)}s · {fmt(60 / r.time)}/min</span>
              </span>
              <button onClick={() => onChoose(r.id)} className="shrink-0 px-2 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]">
                {current === r.id ? "Selected" : "Use"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.fullscreenElement ?? document.body
  );
}
