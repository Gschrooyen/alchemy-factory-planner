"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FlaskConical, RotateCcw, Search, X } from "lucide-react";
import { buildCauldronTable, cauldronRecipeFor, downstreamOf, recipeAt, type CauldronItem, type CauldronKind, type CauldronRecipe, type CauldronTable } from "@/lib/cauldron";
import { paradoxRecipeFor } from "@/lib/paradox";
import type { Recipe } from "@/engine/types";
import { getAllRecipes, getRecipeById } from "@/engine/lp-planner/model-builder";
import { getItem, normalizeItemId } from "@/engine/item-utils";
import type { ProductionNode } from "@/engine/types";
import { useFactoryStore } from "@/store/useFactoryStore";

// Each pot's table is ~10 MB and 300 ms to build; keep them for the session once built
const tables: Partial<Record<CauldronKind, CauldronTable>> = {};
const tableFor = (kind: CauldronKind) => (tables[kind] ??= buildCauldronTable(kind));

/** Rough purchase cost of a combination's ingredients, to float the practical ones to the top */
const ingredientCost = (r: CauldronRecipe) =>
  r.inputs.reduce((sum, i) => sum + (getItem(i.id)?.cost || getItem(i.id)?.base_cost || 1000), 0);

const PAGE = 150;

/** Small button on a machine node: swap this item's production to a cauldron brew. LP only. */
export function CauldronSwapButton({ node }: { node: ProductionNode }) {
  const [open, setOpen] = useState(false);
  const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
  const factory = factories.find((f) => f.id === activeFactoryId);
  const itemId = normalizeItemId(node.itemName);
  const item = getItem(itemId);
  if (!factory || factory.plannerMode !== "lp" || !item || node.isRaw) return null;
  // Game rule: only items with a cauldron multiplier > 0 can ever come out of a pot
  if (!(item.cauldron_coef ?? 0)) {
    return (
      <span className="nodrag text-[var(--text-muted)] opacity-40 cursor-not-allowed" title={`${item.name} can't be brewed: no cauldron multiplier in the game data`}>
        <FlaskConical size={12} />
      </span>
    );
  }

  // A brew the solver picked has no override, but the node's recipe tells us its ingredients
  const solverBrew = node.recipeId?.startsWith("auto:") && /cauldron/.test(node.deviceId ?? "") ? getRecipeById(node.recipeId) : undefined;
  const solverInputs = solverBrew?.inputs.flatMap((i) => Array<string>(i.count as number).fill(i.id ?? normalizeItemId(i.name)));
  const active = !!factory.config.cauldronOverrides?.[itemId];
  const reset = () => {
    const { [itemId]: _, ...rest } = factory.config.cauldronOverrides ?? {};
    updateFactoryConfig(factory.id, { cauldronOverrides: rest });
  };
  return (
    <>
      <button
        type="button"
        className={`nodrag ${active || solverBrew ? "text-[var(--accent-gold)]" : "text-[var(--text-muted)] hover:text-[var(--accent-gold)]"}`}
        title={active ? "Brewed in a cauldron (click to change)" : solverBrew ? "Brew chosen by the solver (click to pin or change)" : "Brew this in a cauldron instead…"}
        onClick={() => setOpen(true)}
      >
        <FlaskConical size={12} />
      </button>
      {active && (
        <button
          type="button"
          className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-gold)]"
          title="Back to normal recipes"
          onClick={reset}
        >
          <RotateCcw size={10} />
        </button>
      )}
      {open && <CauldronWizard itemId={itemId} itemName={item.name} initial={solverInputs} onClose={() => setOpen(false)} />}
    </>
  );
}

function CauldronWizard({ itemId, itemName, initial, onClose }: { itemId: string; itemName: string; initial?: string[]; onClose: () => void }) {
  const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
  const factory = factories.find((f) => f.id === activeFactoryId)!;
  // Your pin, or else the solver's choice (shown pre-filled so it can be pinned or tweaked)
  const current = factory.config.cauldronOverrides?.[itemId] ?? initial;
  // Everything the factory already makes or buys: ingredients from this set cost nothing extra to route in
  const inFactory = useMemo(
    () => new Set(factory.nodes.map((n) => normalizeItemId(String((n.data as { itemName?: string })?.itemName ?? ""))).filter((id) => id && id !== itemId)),
    [factory.nodes, itemId]
  );

  // Ingredients made from this item loop back through it: fine when the loop nets a gain (bootstrap by hand),
  // infeasible when it doesn't (e.g. 1 Coke -> 1 Coke Powder -> 1 Coke). Marked ⟳ and sorted last.
  // ...including the factory's other cauldron/paradox brews, which can close a loop the normal recipes don't
  const circular = useMemo(() => {
    const brews: Recipe[] = [];
    for (const [id, inputs] of Object.entries(factory.config.cauldronOverrides ?? {})) { if (id !== itemId) { const r = cauldronRecipeFor(id, inputs); if (r) brews.push(r); } }
    for (const [id, input] of Object.entries(factory.config.paradoxOverrides ?? {})) { if (id !== itemId) { const r = paradoxRecipeFor(id, input); if (r) brews.push(r); } }
    return downstreamOf(itemId, [...getAllRecipes(), ...brews]).add(itemId);
  }, [itemId, factory.config.cauldronOverrides, factory.config.paradoxOverrides]);

  const [kind, setKind] = useState<CauldronKind>(current?.length === 2 ? "advanced" : "basic");
  const [picked, setPicked] = useState<string[]>(current ?? []); // ingredient ids, one per slot
  const [banned, setBanned] = useState<string[]>([]); // ingredient ids to keep out of every combination
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [table, setTable] = useState<CauldronTable | null>(null);
  const slots = kind === "advanced" ? 2 : 3;

  useEffect(() => {
    setTable(null);
    const id = setTimeout(() => setTable(tableFor(kind)), 0);
    return () => clearTimeout(id);
  }, [kind]);

  // Combos that brew this item and contain every picked ingredient (as a multiset)
  const { combos, options } = useMemo(() => {
    const res = { combos: [] as { recipe: CauldronRecipe; known: number; loops: boolean }[], options: [] as { item: CauldronItem; count: number }[] };
    if (!table) return res;
    const outIdx = table.outputs.findIndex((o) => o.id === itemId);
    if (outIdx < 0) return res;
    const counts = new Map<string, { item: CauldronItem; count: number }>();
    for (let r = 0; r < table.size; r++) {
      if (table.out[r] !== outIdx) continue;
      const recipe = recipeAt(table, r);
      const loops = recipe.inputs.some((x) => circular.has(x.id));
      const rest = [...recipe.inputs];
      let ok = true;
      for (const id of picked) {
        const i = rest.findIndex((x) => x.id === id);
        if (i < 0) { ok = false; break; }
        rest.splice(i, 1);
      }
      if (!ok) continue;
      if (recipe.inputs.some((x) => banned.includes(x.id))) continue;
      res.combos.push({ recipe, loops, known: recipe.inputs.filter((x) => inFactory.has(x.id)).length });
      for (const x of rest) {
        const e = counts.get(x.id);
        if (e) e.count++;
        else counts.set(x.id, { item: x, count: 1 });
      }
    }
    // Non-looping first, then most of the factory, then cheapest
    res.combos.sort((a, b) => Number(a.loops) - Number(b.loops) || b.known - a.known || ingredientCost(a.recipe) - ingredientCost(b.recipe));
    res.options = [...counts.values()].sort(
      (a, b) =>
        Number(circular.has(a.item.id)) - Number(circular.has(b.item.id)) ||
        Number(inFactory.has(b.item.id)) - Number(inFactory.has(a.item.id)) ||
        b.count - a.count ||
        a.item.name.localeCompare(b.item.name)
    );
    return res;
  }, [table, itemId, picked, banned, inFactory, circular]);

  const q = search.toLowerCase();
  const shownOptions = options.filter((o) => !q || o.item.name.toLowerCase().includes(q)).slice(0, 60);

  useEffect(() => setLimit(PAGE), [kind, picked, banned]);
  useEffect(() => setPicked((p) => p.slice(0, slots)), [slots]);

  const choose = (inputs: string[] | null) => {
    const { [itemId]: _, ...rest } = factory.config.cauldronOverrides ?? {};
    updateFactoryConfig(factory.id, { cauldronOverrides: inputs ? { ...rest, [itemId]: inputs } : rest });
    onClose();
  };
  const isCurrent = (r: CauldronRecipe) =>
    !!current && current.length === r.inputs.length && [...current].sort().join() === r.inputs.map((i) => i.id).sort().join();

  const chip = (id: string, name: string, extra = "") => (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${inFactory.has(id) ? "bg-[var(--success-dim)]/30 text-[var(--success)]" : "bg-[var(--background-deep)] text-[var(--text-secondary)]"}`}
      title={circular.has(id) ? `${name} is made from ${itemName}: a loop. Works only if it nets a gain (bootstrap by hand).` : undefined}
    >
      {circular.has(id) && <span className="text-[var(--warning)]">⟳</span>}{name}{extra}
    </span>
  );

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-cinzel text-lg text-[var(--accent-gold)] flex items-center gap-2">
            <FlaskConical size={18} /> Brew {itemName} in a cauldron
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CauldronKind)}
              className="px-3 py-1.5 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)]"
            >
              <option value="basic">Cauldron (3 slots)</option>
              <option value="advanced">Advanced Cauldron (2 slots)</option>
            </select>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
          </div>
        </div>

        {/* Slots: what is picked so far */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {Array.from({ length: slots }, (_, i) => {
            const id = picked[i];
            return id ? (
              <button key={i} onClick={() => setPicked((p) => p.filter((_, j) => j !== i))} title="Remove">
                {chip(id, getItem(id)?.name ?? id, " ×")}
              </button>
            ) : (
              <span key={i} className="px-2 py-0.5 rounded border border-dashed border-[var(--border)] text-xs text-[var(--text-muted)]">slot {i + 1}</span>
            );
          })}
          {picked.length > 0 && (
            <button onClick={() => setPicked([])} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">clear</button>
          )}
          {factory.config.cauldronOverrides?.[itemId] ? (
            <button onClick={() => choose(null)} className="ml-auto px-3 py-1 border border-[var(--accent-gold-dim)] rounded-lg text-xs text-[var(--accent-gold)] hover:bg-[var(--surface-elevated)]">
              Back to normal recipes
            </button>
          ) : initial ? (
            <span className="ml-auto text-xs text-[var(--text-muted)]">chosen by the brew solver — "Use" pins it</span>
          ) : null}
        </div>

        {banned.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            Excluded:
            {banned.map((id) => (
              <button key={id} onClick={() => setBanned((b) => b.filter((x) => x !== id))} title="Allow again"
                className="px-2 py-0.5 rounded text-xs bg-[var(--error-dim)]/30 text-[var(--error)] line-through hover:no-underline">
                {getItem(id)?.name ?? id} ×
              </button>
            ))}
            <button onClick={() => setBanned([])} className="hover:text-[var(--text-primary)]">clear</button>
          </div>
        )}

        {/* Ingredient picker: only things that still complete a brew with what is picked */}
        {picked.length < slots && (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={table ? `Add an ingredient… (${options.length} fit, green = already in this factory)` : "Brewing every combination…"}
                className="w-full pl-10 pr-3 py-2 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-gold-dim)]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto custom-scrollbar">
              {shownOptions.map(({ item, count }) => (
                <span key={item.id} className="inline-flex items-center">
                  <button onClick={() => { setPicked((p) => [...p, item.id]); setSearch(""); }} title={`${count} combinations — click to use`} className="hover:brightness-125">
                    {chip(item.id, item.name, " +")}
                  </button>
                  <button
                    onClick={() => setBanned((b) => [...b, item.id])}
                    title={`Exclude ${item.name} from every combination`}
                    className="-ml-1 px-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--error)]"
                  >
                    ⊘
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-[var(--text-muted)]">
          {table ? `${combos.length.toLocaleString()} combinations · green ingredients are already in this factory` : ""}
        </div>

        <div className="overflow-y-auto custom-scrollbar flex-1 rounded-lg border border-[var(--border-subtle)]">
          {table && combos.length === 0 && (
            <div className="p-6 text-center text-sm text-[var(--text-muted)]">Nothing brews {itemName} with those.</div>
          )}
          {combos.slice(0, limit).map(({ recipe: r, known, loops }, i) => (
            <div
              key={i}
              className={`flex items-center justify-between gap-3 px-3 py-1.5 text-sm border-b border-[var(--border-subtle)] ${isCurrent(r) ? "bg-[var(--accent-gold)]/10" : "hover:bg-[var(--surface-elevated)]"}`}
            >
              <span className="flex flex-wrap items-center gap-1">
                {collapse(r.inputs).map(({ item, count }) => <Fragment key={item.id}>{chip(item.id, item.name, count > 1 ? ` ×${count}` : "")}</Fragment>)}
                <span className="ml-1 text-xs text-[var(--text-muted)]">{r.time}s · {r.heat.toLocaleString()} heat{known === r.inputs.length ? " · all in factory" : ""}{loops ? " · loops back" : ""}</span>
              </span>
              <button
                onClick={() => choose(r.inputs.map((x) => x.id))}
                className="shrink-0 px-2 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]"
              >
                {isCurrent(r) ? "Selected" : "Use"}
              </button>
            </div>
          ))}
          {combos.length > limit && (
            <button onClick={() => setLimit((l) => l + PAGE * 2)} className="w-full py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              Show more
            </button>
          )}
        </div>
      </div>
    </div>,
    document.fullscreenElement ?? document.body
  );
}

/** "Diamond + Diamond" becomes one entry consumed twice per brew. */
function collapse(inputs: CauldronItem[]) {
  const out: { item: CauldronItem; count: number }[] = [];
  for (const item of inputs) {
    const prev = out.find((e) => e.item.id === item.id);
    if (prev) prev.count++;
    else out.push({ item, count: 1 });
  }
  return out;
}
