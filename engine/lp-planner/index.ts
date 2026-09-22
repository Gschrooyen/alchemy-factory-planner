import { solve } from "yalps";
import { PlannerConfig, ProductionNode } from "../types";
import { buildEfficiencyContext } from "./efficiency";
import { buildLPModel, getAllRecipes } from "./model-builder";
import { interpretSolution } from "./solution-interpreter";
import { clearLiquidBeltFlags } from "../item-utils";

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

      // Closest exact solve: re-solve with integer machine counts, only over the recipes the
      // continuous plan actually used (keeps branch & bound small).
      const active = new Set<string>();
      for (const [name, value] of solution.variables) {
        if (name.startsWith("recipe_") && value > 1e-6) active.add(name.slice(7));
      }
      const exclude = new Set(excluded);
      getAllRecipes().forEach((r) => { if (!active.has(r.id)) exclude.add(r.id); });
      const intModel = buildLPModel(config, ctx, exclude, active);
      const intSolution = solve(intModel, { timeout: 5000 });
      console.log("[LP Planner] Whole-machine solution status:", intSolution.status);
      if (intSolution.status !== "optimal") return nodes; // fall back to fractional plan
      return interpretSolution(intSolution, config, ctx);
    }
    sinks.forEach((n) => excluded.add(n.recipeId!));
    console.log("[LP Planner] Excluding zero-output sink recipes and re-solving:", [...excluded]);
  }
  return [];
}

// Re-export types for convenience
export * from "./types";
export { buildEfficiencyContext } from "./efficiency";
