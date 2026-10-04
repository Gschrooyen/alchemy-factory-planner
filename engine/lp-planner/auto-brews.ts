import type { PlannerConfig, Recipe } from "../types";
import type { EfficiencyContext } from "./types";
import { getAllItems, getItem, normalizeItemId, getEffectiveRecipeTime, isNurseryMachine, recipeNutrients } from "../item-utils";
import { buildCauldronTable, cauldronTiming, getCauldronInputs, getCauldronOutputs, type CauldronKind, type CauldronTable } from "@/lib/cauldron";
import { getParadoxInputs, paradoxBatchTime, paradoxProductId } from "@/lib/paradox";

/**
 * Brew solver: finds cauldron / advanced cauldron / paradox brews worth offering to the LP.
 *
 * The LP can't take a million cauldron combinations as variables, but almost all of them are useless:
 * a brew only matters when its ingredients are cheaper than the item's current best recipe. So:
 *   1. propagate a unit cost for every item (raw price, or inputs' cost per unit through recipes,
 *      iterated to a fixed point so loops settle) — gold, or machine-minutes when minimising machines;
 *   2. score every brew by its ingredients' unit costs and keep the best few that beat the item's cost;
 *   3. repeat, because new brews lower the cost of ingredients for other brews.
 * The winners go into the LP as extra candidate recipes; the LP still makes the final, exact choice
 * (heat, fertilizer, byproducts, whole machines). Deterministic: same inputs, same brews.
 */

export const AUTO_BREW_PREFIX = "auto:";
const ROUNDS = 4;
const PER_ITEM = 3; // candidates kept per item per pot kind
const MARGIN = 0.98; // must beat the current cost by 2% to be worth a variable

const tables: Partial<Record<CauldronKind, CauldronTable>> = {};
const tableFor = (kind: CauldronKind) => (tables[kind] ??= buildCauldronTable(kind));

const outId = (o: Recipe["outputs"][number]) => o.id || normalizeItemId(o.name);
const inId = (i: Recipe["inputs"][number]) => i.id || normalizeItemId(i.name);
const num = (v: number | string) => (typeof v === "string" ? parseFloat(v) : v);

type Metric = "cost" | "machines";

/** Cheapest known unit cost of every item under the given recipe set. Infinity = not makeable. */
const machinePriceFor = (config: PlannerConfig, metric: Metric) => (metric === "machines" ? 1 : config.machineCost ?? 0);

function unitCosts(recipes: Recipe[], config: PlannerConfig, ctx: EfficiencyContext, metric: Metric): Map<string, number> {
  const cost = new Map<string, number>();
  const machinePrice = machinePriceFor(config, metric);
  const fert = ctx.selectedFertilizer ? getItem(ctx.selectedFertilizer) : undefined;
  const fertUnit = () => (fert ? cost.get(fert.id) ?? Infinity : Infinity);

  // Raw: what the LP can actually buy, at the LP's price (machines metric: raws are free of machines).
  // That's items no recipe makes, plus fuel/fertilizer when not self-produced. Nearly every item has a
  // `cost` (its value), so treating all of them as buyable made every item "free" in machines mode (no
  // brew could ever win) and capped intermediates at their value in cost mode.
  const produced = new Set(recipes.flatMap((r) => r.outputs.map(outId)));
  const fuelId = normalizeItemId(ctx.selectedFuel);
  for (const item of getAllItems()) {
    if (item.hidden) continue;
    const forcedRaw = (!ctx.selfFuel && item.id === fuelId) || (!ctx.selfFertilizer && item.id === fert?.id);
    // Fuel/fertilizer from outside the factory is free here, as in the LP
    if (forcedRaw) cost.set(item.id, 0);
    else if (!produced.has(item.id)) cost.set(item.id, metric === "cost" ? item.cost || item.base_cost || 1000 : 0);
  }
  // User-supplied resources are (nearly) free either way
  for (const res of config.availableResources ?? []) cost.set(normalizeItemId(res.item), 0);

  const perUnit = (r: Recipe): number => {
    const primary = r.outputs[0];
    const outCount = num(primary.count) * ((primary.percentage ? num(primary.percentage) : 100) / 100);
    if (outCount <= 0) return Infinity;
    const nursery = isNurseryMachine(r.crafted_in?.toLowerCase() ?? "");
    let inputs = 0;
    for (const i of r.inputs) {
      // Same assumption as the LP model: nursery seeds are planted, not consumed per cycle
      if (nursery && getItem(inId(i))?.name.toLowerCase().endsWith(" seeds")) continue;
      const c = cost.get(inId(i));
      if (c === undefined) return Infinity;
      inputs += c * num(i.count);
    }
    const time = getEffectiveRecipeTime(r, ctx.selectedFertilizer, ctx.fertilizerMultiplier, ctx.beltLimit, ctx.speedMultiplier);
    if (nursery && fert?.nutrient_value) {
      const units = recipeNutrients(r) / (fert.nutrient_value * ctx.fertilizerMultiplier);
      const fc = fertUnit();
      if (!isFinite(fc)) return Infinity;
      inputs += units * fc;
    }
    // own machine time per activation: machine-minutes (machines metric) or their gold price (cost metric)
    const own = (time / ctx.speedMultiplier / 60) * machinePrice;
    return (inputs + own) / outCount;
  };

  for (let pass = 0; pass < 25; pass++) {
    let changed = false;
    for (const r of recipes) {
      const id = outId(r.outputs[0]);
      const c = perUnit(r);
      if (c < (cost.get(id) ?? Infinity) - 1e-9) { cost.set(id, c); changed = true; }
    }
    if (!changed) break;
  }
  return cost;
}

function brewRecipe(kind: CauldronKind, ings: { id: string; name: string }[], output: { id: string; name: string; ct: number }, n: number): Recipe {
  const counts = new Map<string, { name: string; count: number }>();
  for (const i of ings) { const e = counts.get(i.id); if (e) e.count++; else counts.set(i.id, { name: i.name, count: 1 }); }
  const { time, heat } = cauldronTiming(output.ct);
  return {
    id: `${AUTO_BREW_PREFIX}${kind}:${output.id}:${n}`,
    inputs: [...counts].map(([id, { name, count }]) => ({ id, name, count })),
    outputs: [{ id: output.id, name: output.name, count: 1 }],
    time,
    crafted_in: kind === "advanced" ? "advanced-cauldron" : "cauldron",
    heat_per_second: heat,
  };
}

/** Brews that beat the current best recipe of their product, given unit costs. */
function findBrews(cost: Map<string, number>, metric: Metric, config: PlannerConfig, ctx: EfficiencyContext, itemsOfInterest: Set<string>): Recipe[] {
  const found: Recipe[] = [];
  const machinePrice = machinePriceFor(config, metric);
  for (const kind of ["basic", "advanced"] as CauldronKind[]) {
    const table = tableFor(kind);
    const best = new Map<number, { score: number; row: number }[]>(); // output index -> top rows
    for (let r = 0; r < table.size; r++) {
      const o = table.outputs[table.out[r]];
      if (!itemsOfInterest.has(o.id)) continue;
      const a = cost.get(table.inputs[table.i[r]].id), b = cost.get(table.inputs[table.j[r]].id);
      if (a === undefined || b === undefined) continue;
      let score = a + b;
      if (kind === "basic") { const c = cost.get(table.inputs[table.k[r]].id); if (c === undefined) continue; score += c; }
      score += (cauldronTiming(o.ct).time / ctx.speedMultiplier / 60) * machinePrice;
      if (score >= (cost.get(o.id) ?? Infinity) * MARGIN) continue;
      const list = best.get(table.out[r]) ?? [];
      list.push({ score, row: r });
      list.sort((x, y) => x.score - y.score);
      if (list.length > PER_ITEM) list.pop();
      best.set(table.out[r], list);
    }
    best.forEach((list, outIdx) => {
      const o = table.outputs[outIdx];
      list.forEach(({ row }, n) => {
        const ings = [table.inputs[table.i[row]], table.inputs[table.j[row]]];
        if (kind === "basic") ings.push(table.inputs[table.k[row]]);
        found.push(brewRecipe(kind, ings, o, n));
      });
    });
  }
  // Paradox: every belt item -> Mors, Mors -> Vitae; one unit per batch
  for (const target of ["mors", "vitae"]) {
    if (!itemsOfInterest.has(target)) continue;
    const out = getItem(target);
    if (!out) continue;
    const options = getParadoxInputs()
      .filter((i) => paradoxProductId(i.id) === target && cost.has(i.id))
      .map((i) => ({ i, score: cost.get(i.id)! + (paradoxBatchTime(i.id, i.cc, 1) / ctx.speedMultiplier / 60) * machinePrice }))
      .filter(({ score }) => score < (cost.get(target) ?? Infinity) * MARGIN)
      .sort((x, y) => x.score - y.score)
      .slice(0, PER_ITEM);
    options.forEach(({ i }, n) =>
      found.push({
        id: `${AUTO_BREW_PREFIX}paradox:${target}:${n}`,
        inputs: [{ id: i.id, name: i.name, count: 1 }],
        outputs: [{ id: target, name: out.name, count: 1 }],
        time: paradoxBatchTime(i.id, i.cc, 1),
        crafted_in: "paradox-crucible",
        heat_per_second: 1200,
      })
    );
  }
  return found;
}

// The whole-machines path builds the model twice per plan; the second call has the same inputs
let lastKey = "";
let lastBrews: Recipe[] = [];

/** Extra candidate recipes for the LP. `recipes` is the active set (normal recipes plus user brews). */
export function suggestBrews(recipes: Recipe[], config: PlannerConfig, ctx: EfficiencyContext): Recipe[] {
  const key = JSON.stringify([recipes.map((r) => r.id), config.targets, config.availableResources, config.optimizeFor, config.machineCost,
    config.cauldronOverrides, config.paradoxOverrides, config.recipeOverrides, config.recipeSplits, config.useEnhancedGrinder, ctx]);
  if (key === lastKey) return lastBrews;
  lastKey = key;
  return (lastBrews = computeBrews(recipes, config, ctx));
}

function computeBrews(recipes: Recipe[], config: PlannerConfig, ctx: EfficiencyContext): Recipe[] {
  const metric: Metric = config.optimizeFor === "machines" ? "machines" : "cost";
  // Items the user already pinned or brews by hand keep their choice
  const pinned = new Set([
    ...Object.keys(config.cauldronOverrides ?? {}),
    ...Object.keys(config.paradoxOverrides ?? {}),
    ...Object.keys(config.recipeOverrides ?? {}),
    ...Object.keys(config.recipeSplits ?? {}),
  ]);
  const brewable = new Set([...getCauldronOutputs(getCauldronInputs()).map((o) => o.id), "mors", "vitae"].filter((id) => !pinned.has(id)));

  let pool = recipes;
  const chosen = new Map<string, Recipe>();
  for (let round = 0; round < ROUNDS; round++) {
    const cost = unitCosts(pool, config, ctx, metric);
    const brews = findBrews(cost, metric, config, ctx, brewable);
    let added = 0;
    for (const b of brews) {
      // Same ingredients as an earlier round's brew -> same id -> no change
      const key = `${b.crafted_in}|${b.outputs[0].id}|${b.inputs.map((i) => `${i.id}x${i.count}`).sort().join(",")}`;
      if (!chosen.has(key)) { chosen.set(key, b); added++; }
    }
    if (added === 0) break;
    pool = [...recipes, ...chosen.values()];
  }
  // Stable ids regardless of discovery order
  return [...chosen.values()].map((b, n) => ({ ...b, id: `${AUTO_BREW_PREFIX}${b.crafted_in}:${b.outputs[0].id}:${n}` }));
}
