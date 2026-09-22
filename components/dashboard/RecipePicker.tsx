"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { GitFork, RotateCcw, X } from "lucide-react";
import { getAllRecipes } from "@/engine/lp-planner/model-builder";
import { getItem, normalizeItemId, resolveMachineName } from "@/engine/item-utils";
import type { ProductionNode, Recipe } from "@/engine/types";
import { useFactoryStore } from "@/store/useFactoryStore";

const outId = (o: Recipe["outputs"][number]) => o.id || normalizeItemId(o.name);

/** Every normal recipe that yields the item, primary product first. */
export function recipesFor(itemId: string): { recipe: Recipe; primary: boolean }[] {
  return getAllRecipes()
    .filter((r) => r.outputs.some((o) => outId(o) === itemId))
    .map((recipe) => ({ recipe, primary: outId(recipe.outputs[0]) === itemId }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** Small button on a node: choose which recipe makes this item (shown when there is a choice). LP only. */
export function RecipeSwapButton({ node }: { node: ProductionNode }) {
  const [open, setOpen] = useState(false);
  const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
  const factory = factories.find((f) => f.id === activeFactoryId);
  const itemId = normalizeItemId(node.itemName);
  const item = getItem(itemId);
  if (!factory || factory.plannerMode !== "lp" || !item || node.isRaw) return null;
  const options = recipesFor(itemId);
  if (options.length < 2) return null;

  const current = factory.config.recipeOverrides?.[itemId];
  const choose = (recipeId: string | null) => {
    const { [itemId]: _, ...rest } = factory.config.recipeOverrides ?? {};
    updateFactoryConfig(factory.id, { recipeOverrides: recipeId ? { ...rest, [itemId]: recipeId } : rest });
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className={`nodrag ${current ? "text-[var(--accent-gold)]" : "text-[var(--text-muted)] hover:text-[var(--accent-gold)]"}`}
        title={current ? "Recipe pinned (click to change)" : `Choose which recipe makes ${item.name}…`}
        onClick={() => setOpen(true)}
      >
        <GitFork size={12} />
      </button>
      {current && (
        <button type="button" className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-gold)]" title="Let the planner choose again" onClick={() => choose(null)}>
          <RotateCcw size={10} />
        </button>
      )}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setOpen(false)}>
            <div className="w-full max-w-2xl max-h-[85vh] flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-4">
                <h3 className="font-cinzel text-lg text-[var(--accent-gold)] flex items-center gap-2">
                  <GitFork size={18} /> How to make {item.name}
                </h3>
                <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Pin one recipe and the planner stops counting {item.name} from any other (except recipes that also consume it, so
                recycling loops keep working). Cauldron and paradox brews have their own buttons.
              </p>
              <div className="overflow-y-auto custom-scrollbar flex-1 rounded-lg border border-[var(--border-subtle)]">
                <Row label="Auto — let the planner choose" hint="" selected={!current} onPick={() => choose(null)} />
                {options.map(({ recipe, primary }) => (
                  <Row
                    key={recipe.id}
                    label={`${recipe.inputs.map((i) => `${i.count} ${i.name}`).join(" + ") || "—"} → ${recipe.outputs.map((o) => `${o.count} ${o.name}${o.percentage ? ` (${o.percentage}%)` : ""}`).join(", ")}`}
                    hint={`${resolveMachineName(recipe.crafted_in)} · ${recipe.time}s${primary ? "" : " · byproduct"}`}
                    selected={current === recipe.id}
                    onPick={() => choose(recipe.id)}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.fullscreenElement ?? document.body
        )}
    </>
  );
}

function Row({ label, hint, selected, onPick }: { label: string; hint: string; selected: boolean; onPick: () => void }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 text-sm border-b border-[var(--border-subtle)] ${selected ? "bg-[var(--accent-gold)]/10" : "hover:bg-[var(--surface-elevated)]"}`}>
      <span className="text-[var(--text-primary)]">
        {label}
        {hint && <span className="ml-2 text-xs text-[var(--text-muted)]">{hint}</span>}
      </span>
      <button onClick={onPick} className="shrink-0 px-2 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]">
        {selected ? "Selected" : "Use"}
      </button>
    </div>
  );
}
