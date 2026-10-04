"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { FlaskConical, GitFork, Infinity as InfinityIcon, RotateCcw, X } from "lucide-react";
import { getAllRecipes, splitBrewKey, splitBrewRecipe, SPLIT_BREW_PREFIX } from "@/engine/lp-planner/model-builder";
import { getItem, normalizeItemId, resolveMachineName } from "@/engine/item-utils";
import type { ProductionNode, Recipe } from "@/engine/types";
import { useFactoryStore } from "@/store/useFactoryStore";
import { CauldronWizard } from "./CauldronWizard";
import { ParadoxPicker } from "./ParadoxPicker";

const outId = (o: Recipe["outputs"][number]) => o.id || normalizeItemId(o.name);

/** Every normal recipe that yields the item, primary product first. */
export function recipesFor(itemId: string): { recipe: Recipe; primary: boolean }[] {
  return getAllRecipes()
    .filter((r) => r.outputs.some((o) => outId(o) === itemId))
    .map((recipe) => ({ recipe, primary: outId(recipe.outputs[0]) === itemId }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

const isParadoxProduct = (itemId: string) => itemId === "mors" || itemId === "vitae";

/** Small button on a node: choose which recipe makes this item, or split it across several recipes and brews
 *  (shown when there is a choice). LP only. */
export function RecipeSwapButton({ node }: { node: ProductionNode }) {
  const [open, setOpen] = useState(false);
  const { factories, activeFactoryId, updateFactoryConfig } = useFactoryStore();
  const factory = factories.find((f) => f.id === activeFactoryId);
  const itemId = normalizeItemId(node.itemName);
  const item = getItem(itemId);
  if (!factory || factory.plannerMode !== "lp" || !item || node.isRaw) return null;
  const options = recipesFor(itemId);
  const brewable = !!item.cauldron_coef || isParadoxProduct(itemId);
  if (options.length + (brewable ? 1 : 0) < 2) return null;

  const current = factory.config.recipeOverrides?.[itemId];
  const split = factory.config.recipeSplits?.[itemId];
  // A pin, a split and a single cauldron/paradox brew are exclusive: setting one clears the others
  const apply = (recipeId: string | null, shares: Record<string, number> | null) => {
    const { [itemId]: _p, ...pins } = factory.config.recipeOverrides ?? {};
    const { [itemId]: _s, ...splits } = factory.config.recipeSplits ?? {};
    const { [itemId]: _c, ...cauldron } = factory.config.cauldronOverrides ?? {};
    const { [itemId]: _x, ...paradox } = factory.config.paradoxOverrides ?? {};
    updateFactoryConfig(factory.id, {
      recipeOverrides: recipeId ? { ...pins, [itemId]: recipeId } : pins,
      recipeSplits: shares ? { ...splits, [itemId]: shares } : splits,
      ...(shares && { cauldronOverrides: cauldron, paradoxOverrides: paradox }),
    });
    setOpen(false);
  };
  const choose = (recipeId: string | null) => apply(recipeId, null);

  // Brews to offer in the split: the ones already in it, plus the item's current single brew (so it can be split)
  const cauldronPin = factory.config.cauldronOverrides?.[itemId];
  const paradoxPin = factory.config.paradoxOverrides?.[itemId];
  const initialBrews = [
    ...Object.keys(split ?? {}).filter((k) => k.startsWith(SPLIT_BREW_PREFIX)),
    ...(cauldronPin ? [splitBrewKey("cauldron", cauldronPin)] : []),
    ...(paradoxPin ? [splitBrewKey("paradox", [paradoxPin])] : []),
  ];

  return (
    <>
      <button
        type="button"
        className={`nodrag ${current || split ? "text-[var(--accent-gold)]" : "text-[var(--text-muted)] hover:text-[var(--accent-gold)]"}`}
        title={split ? "Split between recipes (click to change)" : current ? "Recipe pinned (click to change)" : `Choose or split which recipes make ${item.name}…`}
        onClick={() => setOpen(true)}
      >
        <GitFork size={12} />
      </button>
      {(current || split) && (
        <button type="button" className="nodrag text-[var(--text-muted)] hover:text-[var(--accent-gold)]" title="Let the planner choose again" onClick={() => choose(null)}>
          <RotateCcw size={10} />
        </button>
      )}
      {open && (
        <RecipeDialog
          itemId={itemId}
          itemName={item.name}
          options={options}
          brewable={!!item.cauldron_coef}
          initialBrews={[...new Set(initialBrews)]}
          current={current}
          split={split}
          onPin={choose}
          onSplit={(shares) => apply(null, shares)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** "Cauldron: Clay ×2 + Lavender" for a brew split key. */
function brewLabel(key: string): { label: string; hint: string } {
  const [, kind, arg = ""] = key.split(":");
  const counts = new Map<string, number>();
  for (const id of arg.split(",")) counts.set(id, (counts.get(id) ?? 0) + 1);
  const names = [...counts].map(([id, n]) => `${getItem(id)?.name ?? id}${n > 1 ? ` ×${n}` : ""}`).join(" + ");
  const pot = kind === "paradox" ? "Paradox Crucible" : arg.split(",").length === 2 ? "Advanced Cauldron" : "Cauldron";
  return { label: `${pot}: ${names}`, hint: "" };
}

function RecipeDialog({ itemId, itemName, options, brewable, initialBrews, current, split, onPin, onSplit, onClose }: {
  itemId: string;
  itemName: string;
  options: { recipe: Recipe; primary: boolean }[];
  brewable: boolean;
  initialBrews: string[];
  current?: string;
  split?: Record<string, number>;
  onPin: (recipeId: string | null) => void;
  onSplit: (shares: Record<string, number>) => void;
  onClose: () => void;
}) {
  // % per recipe or brew; blank/0 = not used in the split
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(split ?? {}).map(([id, v]) => [id, String(v)]))
  );
  const [brews, setBrews] = useState<string[]>(initialBrews);
  const [adding, setAdding] = useState<"cauldron" | "paradox" | null>(null);
  const used: Record<string, number> = {};
  for (const [id, v] of Object.entries(shares)) if (parseFloat(v) > 0) used[id] = parseFloat(v);
  const total = Object.values(used).reduce((a, b) => a + b, 0);
  const canSplit = Object.keys(used).length >= 2;
  const addBrew = (key: string) => {
    if (!splitBrewRecipe(itemId, key)) return;
    setBrews((b) => (b.includes(key) ? b : [...b, key]));
  };
  const setShare = (id: string) => (v: string) => setShares((s) => ({ ...s, [id]: v }));

  if (adding === "cauldron") {
    return <CauldronWizard itemId={itemId} itemName={itemName} onPick={(inputs) => addBrew(splitBrewKey("cauldron", inputs))} onClose={() => setAdding(null)} />;
  }
  if (adding === "paradox") {
    return <ParadoxPicker itemId={itemId} itemName={itemName} onChoose={(input) => { if (input) addBrew(splitBrewKey("paradox", [input])); setAdding(null); }} onClose={() => setAdding(null)} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col gap-4 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-cinzel text-lg text-[var(--accent-gold)] flex items-center gap-2">
            <GitFork size={18} /> How to make {itemName}
          </h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Pin one recipe and the planner stops counting {itemName} from any other (except recipes that also consume it, so
          recycling loops keep working). Or give several recipes and brews a share to split production between them.
        </p>
        <div className="overflow-y-auto custom-scrollbar flex-1 rounded-lg border border-[var(--border-subtle)]">
          <Row label="Auto — let the planner choose" hint="" selected={!current && !split} onPick={() => onPin(null)} />
          {options.map(({ recipe, primary }) => (
            <Row
              key={recipe.id}
              label={`${recipe.inputs.map((i) => `${i.count} ${i.name}`).join(" + ") || "—"} → ${recipe.outputs.map((o) => `${o.count} ${o.name}${o.percentage ? ` (${o.percentage}%)` : ""}`).join(", ")}`}
              hint={`${resolveMachineName(recipe.crafted_in)} · ${recipe.time}s${primary ? "" : " · byproduct"}`}
              selected={!split && current === recipe.id}
              onPick={() => onPin(recipe.id)}
              share={shares[recipe.id] ?? ""}
              onShare={setShare(recipe.id)}
            />
          ))}
          {brews.map((key) => {
            const r = splitBrewRecipe(itemId, key);
            const { label } = brewLabel(key);
            return (
              <Row
                key={key}
                label={label}
                hint={r ? `${r.time}s · ${r.heat_per_second?.toLocaleString()} heat` : ""}
                onRemove={() => { setBrews((b) => b.filter((k) => k !== key)); setShare(key)(""); }}
                share={shares[key] ?? ""}
                onShare={setShare(key)}
              />
            );
          })}
        </div>
        {(brewable || isParadoxProduct(itemId)) && (
          <div className="flex items-center gap-2 text-xs">
            {brewable && (
              <button onClick={() => setAdding("cauldron")} className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]">
                <FlaskConical size={12} /> Add cauldron brew…
              </button>
            )}
            {isParadoxProduct(itemId) && (
              <button onClick={() => setAdding("paradox")} className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]">
                <InfinityIcon size={12} /> Add paradox input…
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span>
            Split: give two or more rows a share (%), e.g. 60 / 40.
            {canSplit && total !== 100 && <span className="text-[var(--text-muted)]"> Shares are relative (total {total}).</span>}
          </span>
          {split && (
            <button onClick={() => onPin(null)} className="ml-auto px-2 py-1 rounded border border-[var(--border)] hover:text-[var(--text-primary)]">
              Clear split
            </button>
          )}
          <button
            disabled={!canSplit}
            onClick={() => onSplit(used)}
            className={`${split ? "" : "ml-auto "}px-3 py-1 rounded border border-[var(--accent-gold-dim)] text-[var(--accent-gold)] hover:bg-[var(--surface-elevated)] disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            Split
          </button>
        </div>
      </div>
    </div>,
    document.fullscreenElement ?? document.body
  );
}

function Row({ label, hint, selected, onPick, onRemove, share, onShare }: {
  label: string; hint: string; selected?: boolean; onPick?: () => void; onRemove?: () => void; share?: string; onShare?: (v: string) => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3 py-2 text-sm border-b border-[var(--border-subtle)] ${selected ? "bg-[var(--accent-gold)]/10" : "hover:bg-[var(--surface-elevated)]"}`}>
      <span className="text-[var(--text-primary)]">
        {label}
        {hint && <span className="ml-2 text-xs text-[var(--text-muted)]">{hint}</span>}
      </span>
      {onShare && (
        <label className="shrink-0 ml-auto flex items-center gap-1 text-xs text-[var(--text-muted)]" title="Share of this item made this way (for a split)">
          <input
            type="number"
            min={0}
            value={share}
            onChange={(e) => onShare(e.target.value)}
            placeholder="–"
            className="w-14 bg-[var(--background-deep)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-right text-[var(--text-primary)]"
          />
          %
        </label>
      )}
      {onPick && (
        <button onClick={onPick} className="shrink-0 px-2 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent-gold)] hover:text-[var(--accent-gold)]">
          {selected ? "Selected" : "Use"}
        </button>
      )}
      {onRemove && (
        <button onClick={onRemove} title="Remove from the split" className="shrink-0 px-2 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--error)]">
          <X size={12} />
        </button>
      )}
    </div>
  );
}
