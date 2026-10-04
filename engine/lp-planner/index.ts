import { solve } from "yalps";
import { PlannerConfig, ProductionNode, Recipe } from "../types";
import type { EfficiencyContext } from "./types";
import { buildEfficiencyContext } from "./efficiency";
import { buildLPModel, getRecipeById } from "./model-builder";
import { interpretSolution } from "./solution-interpreter";
import { clearLiquidBeltFlags, getItem, isNurseryMachine, normalizeItemId, resolveMachineName } from "../item-utils";

/**
 * Calculate production using Linear Programming (Matrix Solver).
 *
 * This is an alternative to the recursive planner that:
 * - Handles circular dependencies naturally
 * - Optimizes recipe selection to minimize raw material cost
 * - Properly accounts for byproduct utilization
 *
 * @param config - Planner configuration (targets, research levels, etc.)
 * @returns Array of ProductionNode trees, one per target
 */
export function calculateProductionLP(config: PlannerConfig): ProductionNode[] {
  return clearLiquidBeltFlags(solveLP(config));
}

function solveLP(config: PlannerConfig): ProductionNode[] {
  // Early exit if no targets
  const targets = config.targets?.length
    ? config.targets
    : config.targetItem && config.targetRate
      ? [{ item: config.targetItem, rate: config.targetRate }]
      : [];

  if (targets.length === 0) {
    return [];
  }

  console.log("[LP Planner] Starting calculation for targets:", targets);

  // Build efficiency context from config
  const ctx = buildEfficiencyContext(config);
  console.log("[LP Planner] Efficiency context:", ctx);

  // ponytail: the solver can "use" surplus heat by feeding a pure conversion loop (e.g. Mors <->
  // Vitae in a paradox crucible) that makes nothing. Detect such zero-output orphan production,
  // exclude those recipes, and re-solve.
  const excluded = new Set<string>();

  for (let attempt = 0; attempt < 5; attempt++) {
    const model = buildLPModel(config, ctx, excluded);
    console.log("[LP Planner] Model built with", Object.keys(model.variables).length, "variables");

    const solution = solve(model);
    console.log("[LP Planner] Solution status:", solution.status);

    if (solution.status !== "optimal") {
      console.warn("[LP Planner] No optimal solution found");
      return [];
    }

    console.log("[LP Planner] Objective value (total cost):", solution.result);

    const nodes = interpretSolution(solution, config, ctx);
    // Sinks: orphan production that either makes nothing net, or exists only to burn heat while
    // buying raw inputs for it (e.g. buy Vitality Essence -> Oblivion Essence in a paradox crucible).
    // Legit orphans consume something the plan already produces (e.g. Plank -> Charcoal).
    const sinks = nodes.filter((n) => {
      if (!n.isOrphanRoot || !n.recipeId) return false;
      if ((n.netOutputRate ?? n.rate) < 1e-6) return true;
      const materialInputs = n.inputs.filter((i) => i.inputKind !== "fuel");
      return materialInputs.length > 0 && materialInputs.every((i) => i.isRaw);
    });
    if (sinks.length === 0) {
      console.log("[LP Planner] Generated", nodes.length, "root nodes");
      if (!config.wholeMachines) return nodes;

      const bought = new Set([...solution.variables].filter(([v, x]) => v.startsWith("raw_") && x > 1e-9).map(([v]) => v.slice(4)));
      return solveWholeMachines(config, ctx, excluded, nodes, bought) ?? nodes; // fall back to the fractional plan

    }
    sinks.forEach((n) => excluded.add(n.recipeId!));
    console.log("[LP Planner] Excluding zero-output sink recipes and re-solving:", [...excluded]);
  }
  return [];
}

/**
 * Whole machines, "fill upstream". Over only the recipes the fractional plan used:
 *   1. the start of each chain (recipes that take nothing the plan makes, e.g. nurseries, ore crushers) gets
 *      its machine count rounded up and pinned; fuel/fertilizer makers stay free so they never cap output;
 *   2. every other step gets any whole number of machines, which may idle part of the time, and the targets
 *      are scaled up together as far as those pinned machines can feed (the target is a minimum);
 *   3. at that output, the usual objective (cost or fewest machines) picks the plan.
 */
function solveWholeMachines(config: PlannerConfig, ctx: EfficiencyContext, excluded: Set<string>, nodes: ProductionNode[], bought: Set<string>): ProductionNode[] | null {
  const machines = new Map<string, number>(); // recipeId -> fractional machines in the continuous plan
  const seen = new Set<ProductionNode>();
  const walk = (n: ProductionNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    if (!n.isRaw && !n.isConsumptionReference && n.recipeId) machines.set(n.recipeId, Math.max(machines.get(n.recipeId) ?? 0, n.deviceCount));
    n.inputs.forEach(walk);
  };
  nodes.forEach(walk);
  if (machines.size === 0) return null;

  const idOf = (x: { id?: string; name: string }) => x.id || normalizeItemId(x.name);
  const recipes = [...machines.keys()].map((id) => getRecipeById(id)).filter((r): r is Recipe => !!r);
  const made = new Set(recipes.flatMap((r) => r.outputs.map(idOf)));
  const utility = new Set([normalizeItemId(ctx.selectedFuel), ctx.selectedFertilizer ? normalizeItemId(ctx.selectedFertilizer) : ""]);
  const fixed = new Map<string, number>();
  for (const r of recipes) {
    const nursery = isNurseryMachine(resolveMachineName(r.crafted_in, ctx.useThermalExtractor));
    const inputs = r.inputs.filter((i) => !(nursery && getItem(idOf(i))?.name.toLowerCase().endsWith(" seeds")));
    const startsChain = inputs.every((i) => !made.has(idOf(i)));
    if (startsChain && !utility.has(idOf(r.outputs[0]))) fixed.set(r.id, Math.max(1, Math.ceil(machines.get(r.id)! - 1e-6)));
  }
  const plan = { recipes: new Set(machines.keys()), fixed, buyable: bought };

  const max = solve(buildLPModel(config, ctx, excluded, { ...plan, stage: "max" }), { timeout: 5000 });
  console.log("[LP Planner] Whole machines, max output:", max.status, max.result);
  if (max.status !== "optimal") return null;
  const scale = -max.result;
  const best = solve(buildLPModel(config, ctx, excluded, { ...plan, stage: "cost", minScale: scale * (1 - 1e-6) }), { timeout: 5000 });
  console.log("[LP Planner] Whole machines, cheapest at that output:", best.status);
  return interpretSolution(best.status === "optimal" ? best : max, config, ctx);
}

// Re-export types for convenience
export * from "./types";
export { buildEfficiencyContext } from "./efficiency";
