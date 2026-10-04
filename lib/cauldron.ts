import { getAllItems } from "@/engine/item-utils";
import type { Item, Recipe } from "@/engine/types";

/**
 * Cauldron transmutation, reverse-engineered from ABeltTDGameStateBase::GetCauldronProduct
 * (AlchemyFactory-Win64-Shipping.exe, RVA 0x4A4BA10 and its three selection closures).
 *
 * Every item has a cauldron cost (cc, what it contributes when dissolved), a cauldron target
 * (ct, the value at which it forms) and a multiplier (cm). Only items with cm > 0 can ever come
 * out of the cauldron. The pot takes 2 or 3 ingredients:
 *
 *   3 items            V = (cc1 + cc2 + cc3) * m  product = argmin |ct - V| * cm
 *                      m = 1.0 if all three differ, 0.65 if two match, 0.5 if all three match
 *   2 identical (A+A)  V = ccA                  product = the smallest ct strictly above V, not A
 *   2 different (A+B)  V = |ccA - ccB|          product = argmin |ct - V| * cm, with
 *                                                ct < max(ccA, ccB) and not the pricier input
 *
 * Craft time and heat are then a piecewise-linear function of the product's ct.
 * All four cauldron rows in DT_EnemyCrafting (Ruby/Sapphire/Emerald/Philosopher's Stone) are
 * reproduced exactly by this, including their 1-decimal craft times.
 */

export interface CauldronItem {
  id: string;
  name: string;
  cc: number;
  ct: number;
  cm: number;
}

export interface CauldronRecipe {
  inputs: CauldronItem[]; // 2 or 3, sorted by name
  output: CauldronItem;
  value: number; // V, the number the product was chosen against
  time: number; // seconds
  heat: number; // heat draw
}

const isBeverage = (item: Item) => ([] as string[]).concat(item.category).includes("beverage");

export function toCauldronItem(item: Item): CauldronItem | null {
  const cc = item.cauldron_cost ?? 0;
  // Both pots have belt inputs only (no pipe port), so liquids can never be ingredients; hidden
  // items are in the table but not in the game (e.g. Advanced Bandage, Amethyst, Refined Sand).
  // Brew Barrel beverages don't go in either (confirmed in game; the data has a cauldron cost for them anyway)
  if (cc <= 0 || item.liquid || item.hidden || isBeverage(item)) return null;
  return { id: item.id, name: item.name, cc, ct: item.cauldron_target ?? 0, cm: item.cauldron_coef ?? 0 };
}

/** Everything that can go into the pot. */
export function getCauldronInputs(): CauldronItem[] {
  return getAllItems()
    .map(toCauldronItem)
    .filter((i): i is CauldronItem => i !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything that can come out of the pot (cauldronMulti > 0). No liquid has cm > 0, so
 *  deriving outputs from the (liquid-free) input list loses nothing. */
export function getCauldronOutputs(inputs: CauldronItem[] = getCauldronInputs()): CauldronItem[] {
  return inputs.filter((i) => i.cm > 0);
}

/** One decimal, rounding half up, exactly as the game does (floor(x*10 + 0.5) / 10). */
const round1 = (x: number) => Math.floor(x * 10 + 0.5) / 10;

/** Craft time and heat draw for a product with cauldron target `ct`. */
export function cauldronTiming(ct: number): { time: number; heat: number } {
  let time: number;
  let heat: number;
  if (ct < 100) {
    time = (ct - 1) * 0.030303030303030304 + 3;
    heat = (ct - 1) * 0.1919191919191919 + 1;
  } else if (ct < 1000) {
    time = (ct - 100) * 0.006666666666666667 + 6;
    heat = (ct - 100) * 0.2 + 20;
  } else if (ct < 10000) {
    time = (ct - 1000) * 0.0013333333333333333 + 12;
    heat = (ct - 1000) * 0.14444444444444443 + 200;
  } else {
    time = (ct - 10000) * 3.6363636363636364e-5 + 24;
    heat = (ct - 10000) * 0.008585858585858586 + 1500;
  }
  return {
    time: round1(Math.min(60, Math.max(3, time))),
    heat: round1(Math.min(10000, Math.max(1, heat))),
  };
}

/** The product the game picks for these ingredients, or null if nothing qualifies. */
export function cauldronProduct(
  ingredients: CauldronItem[],
  outputs: CauldronItem[]
): { output: CauldronItem; value: number } | null {
  let value: number;
  let best = Number.MAX_VALUE;
  let pick: CauldronItem | null = null;

  if (ingredients.length === 3) {
    // Repeats are penalised: the game counts the most-repeated ingredient and scales the sum
    const [a, b, c] = ingredients.map((i) => i.id);
    const maxRepeat = a === b && b === c ? 3 : a === b || b === c || a === c ? 2 : 1;
    const scale = maxRepeat === 3 ? 0.5 : maxRepeat === 2 ? 0.65 : 1;
    value = (ingredients[0].cc + ingredients[1].cc + ingredients[2].cc) * scale;
    for (const o of outputs) {
      const score = Math.abs(o.ct - value) * o.cm;
      if (score < best) { best = score; pick = o; }
    }
  } else if (ingredients.length === 2 && ingredients[0].id === ingredients[1].id) {
    const a = ingredients[0];
    value = a.cc;
    for (const o of outputs) {
      if (o.id === a.id) continue;
      const d = o.ct - value;
      if (d <= 0) continue;
      if (d < best) { best = d; pick = o; }
    }
  } else if (ingredients.length === 2) {
    const [a, b] = ingredients;
    const pricier = a.cc > b.cc ? a : b;
    const cap = pricier.cc;
    value = Math.abs(a.cc - b.cc);
    for (const o of outputs) {
      if (o.ct >= cap) continue;
      if (o.id === pricier.id) continue;
      const score = Math.abs(o.ct - value) * o.cm;
      if (score < best) { best = score; pick = o; }
    }
  } else {
    return null;
  }

  return pick ? { output: pick, value } : null;
}

export function makeRecipe(ingredients: CauldronItem[], outputs: CauldronItem[]): CauldronRecipe | null {
  const r = cauldronProduct(ingredients, outputs);
  if (!r) return null;
  return {
    inputs: [...ingredients].sort((x, y) => x.name.localeCompare(y.name)),
    output: r.output,
    value: r.value,
    ...cauldronTiming(r.output.ct),
  };
}

/**
 * Every combination the pot accepts: all 2- and 3-item multisets of the inputs (repeats allowed,
 * the game just sums whatever is in the slots). ~850k rows for the live item list, so this is a
 * generator: iterate lazily and keep only what the UI needs.
 */
export function* enumerateCauldronRecipes(
  inputs: CauldronItem[] = getCauldronInputs(),
  outputs: CauldronItem[] = getCauldronOutputs(inputs)
): Generator<CauldronRecipe> {
  const n = inputs.length;
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const r = makeRecipe([inputs[i], inputs[j]], outputs);
      if (r) yield r;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      for (let k = j; k < n; k++) {
        const r = makeRecipe([inputs[i], inputs[j], inputs[k]], outputs);
        if (r) yield r;
      }
    }
  }
}

/**
 * One pot's whole recipe space packed into typed arrays (~830k rows / ~10 MB for the basic
 * cauldron, ~15k for the advanced one) so the explorer page can filter and sort it in the browser
 * without allocating a million objects. `k` is NO_THIRD for two-ingredient rows.
 */
export const NO_THIRD = 0xffff;

export interface CauldronTable {
  inputs: CauldronItem[];
  outputs: CauldronItem[];
  size: number;
  i: Uint16Array;
  j: Uint16Array;
  k: Uint16Array;
  out: Uint8Array; // index into outputs
  value: Float64Array;
}

/** Which pot: the basic Cauldron takes 3 ingredients, the Advanced (silver) Cauldron takes 2. */
export type CauldronKind = "basic" | "advanced";

export function buildCauldronTable(
  kind: CauldronKind,
  inputs: CauldronItem[] = getCauldronInputs(),
  outputs: CauldronItem[] = getCauldronOutputs(inputs)
): CauldronTable {
  const n = inputs.length;
  const capacity = kind === "advanced" ? (n * (n + 1)) / 2 : (n * (n + 1) * (n + 2)) / 6;
  const i = new Uint16Array(capacity);
  const j = new Uint16Array(capacity);
  const k = new Uint16Array(capacity);
  const out = new Uint8Array(capacity);
  const value = new Float64Array(capacity);
  const outIndex = new Map(outputs.map((o, idx) => [o.id, idx]));
  let size = 0;

  const push = (a: number, b: number, c: number, r: { output: CauldronItem; value: number } | null) => {
    if (!r) return;
    i[size] = a; j[size] = b; k[size] = c;
    out[size] = outIndex.get(r.output.id)!;
    value[size] = r.value;
    size++;
  };

  if (kind === "advanced") {
    for (let a = 0; a < n; a++)
      for (let b = a; b < n; b++)
        push(a, b, NO_THIRD, cauldronProduct([inputs[a], inputs[b]], outputs));
  } else {
    for (let a = 0; a < n; a++)
      for (let b = a; b < n; b++)
        for (let c = b; c < n; c++)
          push(a, b, c, cauldronProduct([inputs[a], inputs[b], inputs[c]], outputs));
  }

  return { inputs, outputs, size, i, j, k, out, value };
}

/** Materialize one row; `speed` is the machine-speed multiplier (Factory Speed research). */
export function recipeAt(table: CauldronTable, row: number, speed = 1): CauldronRecipe {
  const ins = [table.inputs[table.i[row]], table.inputs[table.j[row]]];
  if (table.k[row] !== NO_THIRD) ins.push(table.inputs[table.k[row]]);
  const output = table.outputs[table.out[row]];
  const { time, heat } = cauldronTiming(output.ct);
  return { inputs: ins, output, value: table.value[row], time: time / speed, heat };
}

export const CAULDRON_RECIPE_PREFIX = "cauldron:";

/**
 * A planner recipe for brewing `outputId` from `inputIds` (2 = Advanced Cauldron, 3 = Cauldron),
 * or null if the game would not brew that product from those ingredients.
 */
export function cauldronRecipeFor(outputId: string, inputIds: string[]): Recipe | null {
  const inputs = getCauldronInputs();
  const outputs = getCauldronOutputs(inputs);
  const byId = new Map(inputs.map((i) => [i.id, i]));
  const ings = inputIds.map((id) => byId.get(id)).filter((i): i is CauldronItem => !!i);
  if (ings.length !== inputIds.length || (ings.length !== 2 && ings.length !== 3)) return null;
  const r = cauldronProduct(ings, outputs);
  if (!r || r.output.id !== outputId) return null;
  const { time, heat } = cauldronTiming(r.output.ct);
  const counts = new Map<string, { name: string; count: number }>();
  for (const i of ings) {
    const e = counts.get(i.id);
    if (e) e.count++;
    else counts.set(i.id, { name: i.name, count: 1 });
  }
  return {
    id: CAULDRON_RECIPE_PREFIX + outputId,
    inputs: [...counts].map(([id, { name, count }]) => ({ id, name, count })),
    outputs: [{ id: r.output.id, name: r.output.name, count: 1 }],
    time,
    crafted_in: ings.length === 2 ? "advanced-cauldron" : "cauldron",
    heat_per_second: heat,
  };
}

/** Items whose production (through any normal recipe, transitively) consumes `itemId`. Brewing `itemId`
 *  from one of these is a loop with no net output, which the planner can't solve. */
export function downstreamOf(itemId: string, recipes: Recipe[]): Set<string> {
  const consumers = new Map<string, string[]>(); // item -> items made from it
  for (const r of recipes) {
    const outs = r.outputs.map((o) => o.id ?? o.name.toLowerCase());
    for (const i of r.inputs) {
      const id = i.id ?? i.name.toLowerCase();
      consumers.set(id, [...(consumers.get(id) ?? []), ...outs]);
    }
  }
  const seen = new Set<string>();
  const stack = [itemId];
  while (stack.length) {
    for (const next of consumers.get(stack.pop()!) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen;
}
