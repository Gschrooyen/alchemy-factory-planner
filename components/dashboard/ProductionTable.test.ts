import { describe, expect, test } from "bun:test";
import { collectRows } from "./ProductionTable";
import { calculateProductionLP } from "@/engine/lp-planner";
import type { PlannerConfig } from "@/engine/types";

describe("List view stages", () => {
  test("a machine fed by a byproduct sits at the same stage as one fed by the main product", () => {
    // Gentian Nectar nursery makes Gentian as its byproduct; both brews are one step above it
    const rows = collectRows(calculateProductionLP({
      targets: [{ item: "Copper Powder", rate: 60 }], availableResources: [{ item: "Iron Ingot", rate: 1000 }],
      fuelEfficiency: 0, alchemySkill: 0, factoryEfficiency: 0, logisticsEfficiency: 4, throwingEfficiency: 0,
      fertilizerEfficiency: 0, salesAbility: 0, negotiationSkill: 0, customerMgmt: 0, relicKnowledge: 0,
      selectedFuel: "coal", selfFuel: false,
      recipeSplits: { copperpowder2: { "brew:cauldron:gentiannectar,ironingot": 50, "brew:cauldron:gentian,ironingot": 50 } },
    } as PlannerConfig));
    const brews = rows.filter((r) => r.node.recipeId?.startsWith("brew:"));
    expect(brews).toHaveLength(2);
    expect(brews[0].stage).toBe(brews[1].stage);
  });
});
