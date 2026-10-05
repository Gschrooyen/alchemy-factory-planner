import { Model, Constraint } from "yalps";
import devicesData from "../../data/devices.json";
import recipesData from "../../data/recipes.json";
import { Device, Item, PlannerConfig, Recipe } from "../types";
import { EfficiencyContext, EPSILON } from "./types";
import { getOutputMultiplier } from "./efficiency";
import { cauldronRecipeFor } from "@/lib/cauldron";
import { paradoxRecipeFor } from "@/lib/paradox";
import { suggestBrews } from "./auto-brews";
import { normalizeItemId, getItem as getItemById, getAllItems, getEffectiveRecipeTime, resolveMachineName, isNurseryMachine, recipeNutrients } from "../item-utils";

// Pre-index data
const itemsMap = new Map<string, Item>();
const devicesMap = new Map<string, Device>();
const allRecipes: Recipe[] = recipesData as unknown as Recipe[];

// Cauldron overrides are synthesised per solve; the interpreter looks them up by id afterwards
const syntheticRecipes = new Map<string, Recipe>();

// Enhanced Grinder: "working at twice the speed of a regular one" (buildings.json), same recipes, no heat
export const ENHANCED_GRINDER_SPEED = 2;

/** The recipe set for this config: normal recipes, minus the primary producers of any item the user
 *  chose to brew in a cauldron, plus one synthetic cauldron recipe per such item. */
function activeRecipes(config: PlannerConfig, ctx: EfficiencyContext): Recipe[] {
  syntheticRecipes.clear();
  // Same ids as the grinder recipes, so machine counts and recipe pins carry over; getRecipeById prefers these
  const pool = config.useEnhancedGrinder
    ? allRecipes.map((r) => {
        if (r.crafted_in !== "grinder") return r;
        const enhanced = { ...r, crafted_in: "enhanced-grinder", time: r.time / ENHANCED_GRINDER_SPEED };
        syntheticRecipes.set(r.id, enhanced);
        return enhanced;
      })
    : allRecipes;
  // A cauldron/paradox brew is a recipe pin on its item: the synthetic recipe becomes the only counted source
  const pins: Record<string, string[]> = Object.fromEntries(Object.entries(config.recipeOverrides ?? {}).map(([k, v]) => [k, [v]]));
  for (const [itemId, inputs] of Object.entries(config.cauldronOverrides ?? {})) {
    const r = cauldronRecipeFor(itemId, inputs);
    // An override the game would not brew is ignored rather than leaving the item unmakeable
    if (r) { syntheticRecipes.set(r.id, r); pins[itemId] = [r.id]; }
  }
  for (const [itemId, inputId] of Object.entries(config.paradoxOverrides ?? {})) {
    const r = paradoxRecipeFor(itemId, inputId);
    if (r) { syntheticRecipes.set(r.id, r); pins[itemId] = [r.id]; }
  }
  // A split pins the item to its chosen recipes (normal or brews, and wins over a single brew/pin);
  // the shares themselves are constraints in buildLPModel
  for (const [itemId, shares] of Object.entries(config.recipeSplits ?? {})) {
    for (const key of Object.keys(shares)) {
      const r = key.startsWith(SPLIT_BREW_PREFIX) ? splitBrewRecipe(itemId, key) : undefined;
      if (r) syntheticRecipes.set(key, r);
    }
    pins[itemId] = Object.keys(shares);
  }
  const brewsAndPins = [...syntheticRecipes.values()].filter((r) => !pool.includes(r));
  const base = applyRecipeOverrides([...pool, ...brewsAndPins], pins);
  if (!config.autoBrews) return base;
  // Brew solver: extra candidates the LP may use; pinned items are left alone
  const brews = suggestBrews(base, config, ctx);
  brews.forEach((b) => syntheticRecipes.set(b.id, b));
  return [...base, ...brews];
}

/** Split entries that are brews rather than normal recipes: "brew:cauldron:<ingredient ids, comma-separated>"
 *  or "brew:paradox:<input id>". The key is the recipe id, so an item can split across several brews. */
export const SPLIT_BREW_PREFIX = "brew:";
export const splitBrewKey = (kind: "cauldron" | "paradox", inputs: string[]) => `${SPLIT_BREW_PREFIX}${kind}:${inputs.join(",")}`;
export function splitBrewRecipe(itemId: string, key: string): Recipe | undefined {
  const [, kind, arg = ""] = key.split(":");
  const r = kind === "cauldron" ? cauldronRecipeFor(itemId, arg.split(",")) : kind === "paradox" ? paradoxRecipeFor(itemId, arg) : null;
  return r ? { ...r, id: key } : undefined; // a brew the game wouldn't make is dropped from the split
}

/** "Make X only with recipes R": every other recipe's X output stops counting (dropped entirely when X is its
 *  primary product). Recipes that also consume X keep it, so recycling loops (Lapis returning Shattered
 *  Crystal) stay intact. Unknown recipe ids are ignored. */
function applyRecipeOverrides(recipes: Recipe[], overrides: Record<string, string[]>): Recipe[] {
  const outId = (o: Recipe["outputs"][number]) => o.id || normalizeItemId(o.name);
  const inId = (i: Recipe["inputs"][number]) => i.id || normalizeItemId(i.name);
  let result = recipes;
  for (const [itemId, recipeIds] of Object.entries(overrides)) {
    if (!result.some((r) => recipeIds.includes(r.id))) continue;
    result = result.flatMap((r) => {
      if (recipeIds.includes(r.id) || !r.outputs.some((o) => outId(o) === itemId) || r.inputs.some((i) => inId(i) === itemId)) return [r];
      if (outId(r.outputs[0]) === itemId) return [];
      return [{ ...r, outputs: r.outputs.filter((o) => outId(o) !== itemId) }];
    });
  }
  return result;
}

/** Heat draw for a recipe: the recipe's own figure (cauldrons) or its device's. */
export function recipeHeatSpeed(recipe: Recipe, device: Device | undefined): number | undefined {
  if (recipe.heat_per_second) return recipe.heat_per_second;
  if (device?.heat_consuming_speed && device.category !== "heating") return device.heat_consuming_speed;
  return undefined;
}

getAllItems().forEach((item) => {
  itemsMap.set(item.id, item);
});

(devicesData as Device[]).forEach((device) => {
  devicesMap.set(device.name.toLowerCase(), device);
  devicesMap.set(device.id.toLowerCase(), device);
});

// Find items that have no recipe producing them (raw materials)
const itemsWithRecipes = new Set<string>();
allRecipes.forEach((recipe) => {
  recipe.outputs.forEach((output) => {
    const outputId = output.id || output.name.toLowerCase();
    itemsWithRecipes.add(outputId);
  });
});

/**
 * Build the LP model for production planning.
 *
 * Variables:
 * - recipe_<id>: Number of times recipe runs per minute (activation rate)
 * - raw_<item>: Amount of raw material purchased per minute
 *
 * Constraints:
 * - For each item: production - consumption + raw_purchase - available >= target (or 0)
 *
 * Objective:
 * - "cost" (default): minimize the purchase cost of raw materials
 * - "machines": minimize the total machine count, with raw cost kept only as a tie-breaker
 */
export const HEAT_ITEM = "__heat";
const MAX_SCALE = 1000; // whole-machine fill: never scale targets beyond this (guards an unbounded model)
const RECIPE_TIEBREAK = 0.001; // nudge against degenerate surplus-shuffling when minimizing cost
const RAW_TIEBREAK = 1e-6; // when minimizing machines, cheaper raws still win ties
// Supplied resources (and fuel/fertilizer from outside the factory) are free: a flat, tiny price per unit, so
// using fewer still wins ties. Flat, not a share of the item's value: 1e-4 of a 250k Ruby (25/unit) cost more
// than a whole machine in fewest-machines mode, so the planner made Ruby instead of using the Ruby supplied.
const SUPPLY_TIEBREAK = 1e-7;

/**
 * Whole machines, "fill upstream": only `recipes` are in the model, each with a whole machine count that
 * may run below full speed. Machines of the recipes in `fixed` (the start of each chain) are pinned to that
 * count. All targets are scaled together by `scale` (>= 1): stage "max" maximises it; stage "cost" keeps it at
 * `minScale` and minimises the usual objective with machine counts (not runs) as the machine cost.
 */
export interface WholeMachinePlan {
  recipes: Set<string>;
  buyable: Set<string>; // items the fractional plan bought; anything else it only had from supply stays capped at that
  fixed: Map<string, number>;
  stage: "max" | "cost";
  minScale?: number;
}

export function buildLPModel(
  config: PlannerConfig,
  ctx: EfficiencyContext,
  excludeRecipes: Set<string> = new Set(),
  whole?: WholeMachinePlan
): Model<string> {
  const integers: string[] = [];
  const variables = new Map<string, Map<string, number>>();
  const constraints = new Map<string, Constraint>();

  // Track all items involved in recipes
  const allItems = new Set<string>();
  const itemProducedBy = new Map<string, Set<string>>(); // item -> recipes that produce it
  const itemConsumedBy = new Map<string, Set<string>>(); // item -> recipes that consume it

  // Normalize fuel and fertilizer IDs for filtering
  const fuelId = normalizeItemId(ctx.selectedFuel);
  const fertilizerId = ctx.selectedFertilizer ? normalizeItemId(ctx.selectedFertilizer) : null;

  // Build target items lookup
  const targets = new Map<string, number>();
  const finalTargets = config.targets?.length
    ? config.targets
    : config.targetItem && config.targetRate
      ? [{ item: config.targetItem, rate: config.targetRate }]
      : [];

  finalTargets.forEach((t) => {
    const itemId = normalizeItemId(t.item);
    const current = targets.get(itemId) || 0;
    targets.set(itemId, current + t.rate);
  });

  // A fuel/fertilizer that is itself a production target keeps its recipes (the target must be made).
  // With self-fuel off, the heat side is still bought: raw purchases are pinned to exactly what is burned
  // (link_boughtfuel == 0), so they can never cover the target itself.
  const buyTargetFuel = !ctx.selfFuel && targets.has(fuelId);
  const selfFuel = ctx.selfFuel || targets.has(fuelId);
  const selfFertilizer = ctx.selfFertilizer || (fertilizerId !== null && targets.has(fertilizerId));

  const minActivations = new Map<string, number>(); // recipeId -> forced minimum activation rate
  const minimizeMachines = config.optimizeFor === "machines";
  // Machines a recipe needs per unit of activation rate; this is exactly how the solution
  // interpreter derives deviceCount, so summing it is the plan's total machine count.
  const machinesPerActivation = new Map<string, number>();

  // Build item flow coefficients for each recipe
  activeRecipes(config, ctx).forEach((recipe) => {
    // Skip recipes that produce fuel/fertilizer if self-production is disabled
    const recipeProducesFuel = !selfFuel && recipe.outputs.some(output => {
      const outputId = output.id || normalizeItemId(output.name);
      return outputId === fuelId;
    });
    const recipeProducesFertilizer = !selfFertilizer && fertilizerId && recipe.outputs.some(output => {
      const outputId = output.id || normalizeItemId(output.name);
      return outputId === fertilizerId;
    });

    if (recipeProducesFuel || recipeProducesFertilizer || excludeRecipes.has(recipe.id) || (whole && !whole.recipes.has(recipe.id))) {
      return; // Skip this recipe
    }

    const recipeVar = `recipe_${recipe.id}`;
    const recipeCoeffs = new Map<string, number>();

    const machineName = resolveMachineName(recipe.crafted_in, ctx.useThermalExtractor);
    // Nursery cycle time depends on the selected fertilizer (see getEffectiveRecipeTime)
    const recipeTime = getEffectiveRecipeTime(recipe, ctx.selectedFertilizer, ctx.fertilizerMultiplier, ctx.beltLimit, ctx.speedMultiplier);
    const isNurseryRecipe = isNurseryMachine(machineName);
    machinesPerActivation.set(recipeVar, recipeTime / ctx.speedMultiplier / 60);

    // Process outputs (positive flow)
    recipe.outputs.forEach((output) => {
      const itemId = output.id || normalizeItemId(output.name);
      allItems.add(itemId);

      const count = typeof output.count === "string"
        ? parseFloat(output.count)
        : output.count;

      const percentage = output.percentage
        ? (typeof output.percentage === "string"
          ? parseFloat(output.percentage)
          : output.percentage)
        : 100;

      // Rate per activation (recipe runs per minute)
      // If recipe runs 1x/min, how many items are produced?
      const itemsPerActivation = calculatePerActivationRate(
        count,
        percentage,
        recipeTime,
        machineName,
        ctx,
        true // isOutput
      );

      const current = recipeCoeffs.get(itemId) || 0;
      recipeCoeffs.set(itemId, current + itemsPerActivation);

      // Track which recipes produce this item
      if (!itemProducedBy.has(itemId)) {
        itemProducedBy.set(itemId, new Set());
      }
      itemProducedBy.get(itemId)!.add(recipe.id);
    });

    // Process inputs (negative flow)
    // Note: Nursery recipes list seeds as input, but seeds aren't consumed - only fertilizer is
    recipe.inputs.forEach((input) => {
      const itemId = input.id || normalizeItemId(input.name);
      const item = getItemById(itemId);

      // Skip seed inputs for nursery recipes (seeds aren't consumed, only fertilizer is)
      if (isNurseryRecipe && item?.name.toLowerCase().endsWith(" seeds")) {
        return;
      }

      allItems.add(itemId);

      const itemsPerActivation = calculatePerActivationRate(
        input.count,
        100, // inputs don't have percentage
        recipeTime,
        machineName,
        ctx,
        false // isInput
      );

      const current = recipeCoeffs.get(itemId) || 0;
      recipeCoeffs.set(itemId, current - itemsPerActivation);

      // Track which recipes consume this item
      if (!itemConsumedBy.has(itemId)) {
        itemConsumedBy.set(itemId, new Set());
      }
      itemConsumedBy.get(itemId)!.add(recipe.id);
    });

    // Handle nursery fertilizer consumption
    const device = devicesMap.get(machineName);
    const isNursery = isNurseryMachine(machineName);

    if (isNursery && ctx.selectedFertilizer) {
      const fertilizerId = normalizeItemId(ctx.selectedFertilizer);
      const fertilizerItem = itemsMap.get(fertilizerId);
      // Get the output item to check its required_nutrients
      const outputDef = recipe.outputs[0];
      const outputId = outputDef.id || normalizeItemId(outputDef.name);
      const outputItem = itemsMap.get(outputId);

      if (fertilizerItem?.nutrient_value && outputItem?.required_nutrients) {
        allItems.add(fertilizerId);

        // Get output count for later use
        const outputCount = typeof outputDef.count === "string"
          ? parseFloat(outputDef.count)
          : outputDef.count;
        const outputPercentage = outputDef.percentage
          ? (typeof outputDef.percentage === "string"
            ? parseFloat(outputDef.percentage)
            : outputDef.percentage)
          : 100;
        const effectiveOutputCount = outputCount * (outputPercentage / 100);

        // Calculate fertilizer needed per recipe activation
        // Nutrients are per OUTPUT ITEM, not per cycle!
        // Each Flax needs 24 nutrients, so total = outputCount * 24
        // Fertilizer consumption = (outputCount * required_nutrients) / nutrient_value
        // Fertilizer research raises each unit's nutrient value ("Nutrient Value 240%"), so fewer units are eaten
        const effectiveNutrientValue = fertilizerItem.nutrient_value * ctx.fertilizerMultiplier;
        const fertilizerPerActivation = recipeNutrients(recipe) / effectiveNutrientValue; // all outputs (leaf + core)

        const current = recipeCoeffs.get(fertilizerId) || 0;
        recipeCoeffs.set(fertilizerId, current - fertilizerPerActivation);

        if (!itemConsumedBy.has(fertilizerId)) {
          itemConsumedBy.set(fertilizerId, new Set());
        }
        itemConsumedBy.get(fertilizerId)!.add(recipe.id);
      }
    }

    // Handle fuel consumption for heated devices (parent/child relationship)
    const heatSpeed = recipeHeatSpeed(recipe, device);
    if (heatSpeed) {
      const fuelId = normalizeItemId(ctx.selectedFuel);
      const fuelItem = itemsMap.get(fuelId);
      if (fuelItem?.heat_value) {
        allItems.add(fuelId);

        // Get parent furnace information
        const parentFurnace = device?.parent ? devicesMap.get(device.parent) : null;
        const furnaceHeat = parentFurnace?.heat_self || 1; // Default to Stone Stove (1 P/s)
        const furnaceSlots = parentFurnace?.slots || 9; // Default to Stone Stove (9 slots)
        const deviceSlotsRequired = device?.slots_required || 1;

        // Heat per second calculation:
        // - Device consumes heat at device.heat_consuming_speed P/s
        // - Device uses fraction of furnace: deviceSlotsRequired / furnaceSlots
        // - Furnace contributes: furnaceHeat × (deviceSlotsRequired / furnaceSlots) P/s
        const deviceHeatPerSecond = heatSpeed * ctx.speedMultiplier;
        const furnaceContribution = furnaceHeat * (deviceSlotsRequired / furnaceSlots) * ctx.speedMultiplier;
        const totalHeatPerSecond = deviceHeatPerSecond + furnaceContribution;

        // Heat per activation = heat per second × time per activation
        const timePerActivation = recipeTime / ctx.speedMultiplier;
        const heatPerActivation = totalHeatPerSecond * timePerActivation;
        // With burnByproducts, recipes consume a "heat" pseudo-item that any burnable fuel can supply
        const consumedId = config.burnByproducts ? HEAT_ITEM : fuelId;
        const perActivation = config.burnByproducts
          ? heatPerActivation
          : heatPerActivation / (fuelItem.heat_value * ctx.fuelMultiplier);
        allItems.add(consumedId);

        const current = recipeCoeffs.get(consumedId) || 0;
        recipeCoeffs.set(consumedId, current - perActivation);
        if (buyTargetFuel && !config.burnByproducts) recipeCoeffs.set("link_boughtfuel", -perActivation);

        if (!itemConsumedBy.has(consumedId)) {
          itemConsumedBy.set(consumedId, new Set());
        }
        itemConsumedBy.get(consumedId)!.add(recipe.id);
      }
    }

    variables.set(recipeVar, recipeCoeffs);

    // User-built machines: force at least that many to run (surplus flows to outputs)
    const overrideMachines = config.machineOverrides?.[recipe.id];
    if (overrideMachines && overrideMachines > 0) {
      const effectiveTime = recipeTime / ctx.speedMultiplier;
      minActivations.set(recipe.id, overrideMachines * 60 / effectiveTime);
    }

    // Whole machines: machines_<id> is an integer and runs <= machines * runs/min/machine (a machine may idle
    // part of the time, so an odd ratio doesn't force a leftover); pinned count for the start of a chain
    if (whole) {
      const runsPerMachine = 60 / (recipeTime / ctx.speedMultiplier);
      const machineVar = new Map([[`link_${recipe.id}`, runsPerMachine]]);
      const fixed = whole.fixed.get(recipe.id);
      if (fixed !== undefined) {
        machineVar.set(`link_fixed_${recipe.id}`, 1);
        constraints.set(`link_fixed_${recipe.id}`, { equal: fixed });
      }
      variables.set(`machines_${recipe.id}`, machineVar);
      recipeCoeffs.set(`link_${recipe.id}`, -1);
      constraints.set(`link_${recipe.id}`, { min: 0 });
      integers.push(`machines_${recipe.id}`);
    }
  });

  // Burn variables: item -> heat. Selected fuel is always burnable; other fuels only if something produces them.
  if (config.burnByproducts && allItems.has(HEAT_ITEM)) {
    itemProducedBy.set(HEAT_ITEM, new Set());
    getAllItems().forEach((item) => {
      if (!item.heat_value) return;
      if (item.id !== fuelId && !itemProducedBy.has(item.id)) return;
      allItems.add(item.id);
      variables.set(`burn_${item.id}`, new Map([[item.id, -1], [HEAT_ITEM, item.heat_value * ctx.fuelMultiplier]]));
      if (buyTargetFuel && item.id === fuelId) variables.get(`burn_${item.id}`)!.set("link_boughtfuel", -1);
      itemProducedBy.get(HEAT_ITEM)!.add(`burn_${item.id}`);
    });
  }

  // Recipe splits: recipe r makes exactly its share of the item's output from the split's recipes.
  // Shares are renormalised over the recipes still in the model (one may have been excluded).
  for (const [itemId, shares] of Object.entries(config.recipeSplits ?? {})) {
    const out = Object.keys(shares)
      .map((id) => ({ id, share: shares[id], coeff: variables.get(`recipe_${id}`)?.get(itemId) ?? 0 }))
      .filter((r) => r.share > 0 && r.coeff > EPSILON);
    const total = out.reduce((sum, r) => sum + r.share, 0);
    // n-1 constraints pin all n shares (the last follows); for each r: c_r x_r - s_r * sum_q c_q x_q = 0
    out.slice(1).forEach((r) => {
      const key = `link_split_${itemId}_${r.id}`;
      out.forEach((q) => variables.get(`recipe_${q.id}`)!.set(key, (q.id === r.id ? q.coeff : 0) - (r.share / total) * q.coeff));
      constraints.set(key, { equal: 0 });
    });
  }

  // Build available resources lookup
  const availableResources = new Map<string, number>();
  config.availableResources?.forEach((res) => {
    const itemId = normalizeItemId(res.item);
    const current = availableResources.get(itemId) || 0;
    availableResources.set(itemId, current + res.rate);
  });

  const objective = new Map<string, number>();

  // Create constraints for each item
  allItems.forEach((itemName) => {
    const isTarget = targets.has(itemName);
    const targetRate = targets.get(itemName) || 0;
    const availableRate = availableResources.get(itemName) || 0;
    let isRawMaterial = !itemProducedBy.has(itemName) || itemProducedBy.get(itemName)!.size === 0;

    // Force fuel/fertilizer to be raw materials if self-production is disabled
    if (!selfFuel && itemName === fuelId) {
      isRawMaterial = true;
    }
    if (!selfFertilizer && fertilizerId && itemName === fertilizerId) {
      isRawMaterial = true;
    }

    // Create raw material variable if needed (whole machines: only what the fractional plan bought, so filling
    // machines never starts buying an item the user supplied, e.g. a 250k Ruby)
    if (isRawMaterial && (!whole || whole.buyable.has(itemName))) {
      const rawVar = `raw_${itemName}`;
      const rawCoeffs = new Map<string, number>();
      rawCoeffs.set(itemName, 1); // raw purchase adds 1 per unit
      variables.set(rawVar, rawCoeffs);
    }

    // Supplied resources: a supply_ variable capped at the available rate, at a tiny fraction of the item's
    // cost. Free would let the solver waste them (and break ties by activation count instead of by usage).
    if (availableRate > 0) {
      variables.set(`supply_${itemName}`, new Map([[itemName, 1], [`link_supply_${itemName}`, 1]]));
      constraints.set(`link_supply_${itemName}`, { max: availableRate });
      objective.set(`supply_${itemName}`, SUPPLY_TIEBREAK);
    }

    // Constraint: net_flow >= required
    // net_flow = sum(recipe contributions) + raw_purchase + supply - target
    // For targets: net_flow >= targetRate
    // For intermediates: net_flow >= 0 (can't consume more than produced)
    const rhs = isTarget ? targetRate : 0;

    // Leftovers of any item are fine (the game has a trash barrel), so intermediates are ">= 0".
    if (itemName === HEAT_ITEM) {
      // Heat can't be stockpiled: fuel burned must exactly match what machines draw
      constraints.set(`item_${itemName}`, { equal: 0 });
    } else if (isTarget && whole) {
      // Whole machines: the target is a minimum, scaled by `scale` (see below)
      constraints.set(`item_${itemName}`, { min: 0 });
    } else {
      constraints.set(`item_${itemName}`, { min: rhs });
    }
  });

  // Whole machines: every target gets scale * its rate, all together (their ratio is kept)
  if (whole) {
    const scaleVar = new Map<string, number>([["link_scale", 1]]);
    targets.forEach((rate, itemId) => { if (allItems.has(itemId)) scaleVar.set(itemId, -rate); });
    variables.set("scale", scaleVar);
    constraints.set("link_scale", { min: whole.stage === "cost" ? whole.minScale ?? 1 : 1, max: MAX_SCALE });
  }

  if (buyTargetFuel && allItems.has(fuelId)) {
    variables.set(`raw_${fuelId}`, new Map([[fuelId, 1], ["link_boughtfuel", 1]]));
    constraints.set("link_boughtfuel", { equal: 0 });
  }

  // Build objective: raw material cost, scaled right down when machine count is what matters
  variables.forEach((_, varName) => {
    if (varName.startsWith("raw_")) {
      const itemName = varName.slice(4); // Remove "raw_" prefix
      const item = itemsMap.get(itemName);
      const cost = item?.cost || item?.base_cost || 1000; // Default cost if not specified
      // Fuel/fertilizer not produced here comes from outside this factory: free like supplied resources,
      // with just a tie-break so using less of it still wins
      const external = (!ctx.selfFuel && itemName === fuelId) || (!ctx.selfFertilizer && itemName === fertilizerId);
      objective.set(varName, external ? SUPPLY_TIEBREAK : minimizeMachines ? cost * RAW_TIEBREAK : cost);
    }
  });

  // Build variables in YALPS format
  // Each variable maps constraint names to coefficients
  const yalpsVariables: Record<string, Record<string, number>> = {};

  variables.forEach((itemCoeffs, varName) => {
    const varDef: Record<string, number> = {};

    // Add constraint coefficients (link_ keys are machine-count links, not items)
    itemCoeffs.forEach((coeff, itemName) => {
      if (Math.abs(coeff) > EPSILON) {
        varDef[itemName.startsWith("link_") ? itemName : `item_${itemName}`] = coeff;
      }
    });

    // Add objective coefficient for raw materials
    if (objective.has(varName)) {
      varDef.cost = objective.get(varName)!;
    }

    // Minimizing machines means paying per machine a recipe needs; otherwise just a tiny cost per
    // run, so the solver leaves surplus as surplus instead of converting it (degenerate solutions).
    if (varName.startsWith("recipe_")) {
      varDef.cost = minimizeMachines
        ? machinesPerActivation.get(varName) ?? RECIPE_TIEBREAK
        : RECIPE_TIEBREAK + (machinesPerActivation.get(varName) ?? 0) * (config.machineCost ?? 0);
    }

    // Whole machines: pay per machine built (integer), not per run; stage "max" only maximises the scale
    if (whole) {
      if (varName.startsWith("machines_")) varDef.cost = minimizeMachines ? 1 : config.machineCost ?? 0;
      if (varName.startsWith("recipe_")) varDef.cost = RECIPE_TIEBREAK;
      if (whole.stage === "max") varDef.cost = varName === "scale" ? -1 : 0;
    }

    // Pin overridden recipes to at least the user's machine count
    if (varName.startsWith("recipe_") && minActivations.has(varName.slice(7))) {
      varDef[`fix_${varName}`] = 1;
      constraints.set(`fix_${varName}`, { min: minActivations.get(varName.slice(7))! });
    }

    yalpsVariables[varName] = varDef;
  });

  // Convert to YALPS model format
  const model: Model<string> = {
    direction: "minimize",
    objective: "cost",
    constraints: Object.fromEntries(constraints),
    variables: yalpsVariables,
    integers,
  };

  return model;
}

/**
 * Calculate items produced/consumed per recipe activation (1 run/minute).
 */
function calculatePerActivationRate(
  count: number,
  percentage: number,
  recipeTime: number,
  machineName: string,
  ctx: EfficiencyContext,
  isOutput: boolean
): number {
  const effectiveCount = count * (percentage / 100);

  if (isOutput) {
    // Alchemy skill, plus Thermal Extractor build-height bonus
    return effectiveCount * getOutputMultiplier(machineName, ctx);
  } else {
    // Inputs don't get multipliers
    return effectiveCount;
  }
}

/**
 * Get item data by name
 */
export function getItem(nameOrId: string): Item | undefined {
  const itemId = normalizeItemId(nameOrId);
  return itemsMap.get(itemId);
}

/**
 * Get device data by name
 */
export function getDevice(name: string): Device | undefined {
  return devicesMap.get(name.toLowerCase());
}

/**
 * Get all recipes
 */
export function getAllRecipes(): Recipe[] {
  return allRecipes;
}

/**
 * Find recipe by ID
 */
export function getRecipeById(id: string): Recipe | undefined {
  return syntheticRecipes.get(id) ?? allRecipes.find((r) => r.id === id);
}
