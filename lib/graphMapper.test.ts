import { describe, expect, test } from "bun:test";
import { generateGraph } from "./graphMapper";
import { calculateProductionLP } from "../engine/lp-planner/index";
import { PlannerConfig } from "../engine/types";

describe("Graph Mapper", () => {
  test("should generate correct nodes for simple production", async () => {
    const config: PlannerConfig = {
      targets: [{ item: "Plank", rate: 10 }],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Coal",
      selectedFertilizer: "",
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes, edges } = await generateGraph(productionTrees);

    // Should have a target node for Plank
    const targetNodes = nodes.filter((n: any) => n.data.isTarget);
    expect(targetNodes).toHaveLength(1);
    expect(targetNodes[0].data.itemName).toBe("Plank");
    expect(targetNodes[0].data.rate).toBe(10);

    // Should have a production node for Plank
    const productionNodes = nodes.filter(
      (n: any) => !n.data.isTarget && !n.data.isRaw,
    );
    expect(productionNodes.length).toBeGreaterThan(0);

    // Should have raw material node for Logs
    const rawNodes = nodes.filter((n: any) => n.data.isRaw);
    const logsNode = rawNodes.find((n: any) => n.data.itemName === "Logs");
    expect(logsNode).toBeDefined();
    // 1 Log -> 200 Planks, so 10 Planks/min needs 0.05 Logs/min (same as engine/planner.test.ts)
    expect(logsNode.data.rate).toBeCloseTo(0.05, 4);
  });

  test("should handle circular dependencies with correct net output rates", async () => {
    const config: PlannerConfig = {
      targets: [
        { item: "Basic Fertilizer", rate: 10 },
        { item: "Plank", rate: 10 },
      ],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Plank", // Plank used as fuel
      selectedFertilizer: "Basic Fertilizer", // Basic Fertilizer used as fertilizer
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes, edges } = await generateGraph(productionTrees);

    // Should have 2 target nodes
    const targetNodes = nodes.filter((n: any) => n.data.isTarget);
    expect(targetNodes).toHaveLength(2);

    // Find target nodes
    const fertNode = targetNodes.find(
      (n: any) => n.data.itemName === "Basic Fertilizer",
    );
    const plankNode = targetNodes.find(
      (n: any) => n.data.itemName === "Plank",
    );

    expect(fertNode).toBeDefined();
    expect(plankNode).toBeDefined();

    // Target nodes should show net output rate (10/min each)
    expect(fertNode.data.rate).toBeCloseTo(10, 1);
    expect(plankNode.data.rate).toBeCloseTo(10, 1);

    // Verify production nodes exist
    const productionNodes = nodes.filter(
      (n: any) => !n.data.isTarget && !n.data.isRaw,
    );
    expect(productionNodes.length).toBeGreaterThan(0);

    // Verify raw material nodes
    const rawNodes = nodes.filter((n: any) => n.data.isRaw);
    expect(rawNodes.length).toBeGreaterThan(0);

    // Should have Logs as raw material
    const logsNode = rawNodes.find((n: any) => n.data.itemName === "Logs");
    expect(logsNode).toBeDefined();
  });

  test("should generate edges between production nodes", async () => {
    const config: PlannerConfig = {
      targets: [{ item: "Basic Fertilizer", rate: 10 }],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Logs",
      selectedFertilizer: "",
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes, edges } = await generateGraph(productionTrees);

    // Should have edges connecting nodes
    expect(edges.length).toBeGreaterThan(0);

    // Each edge should have source, target, and label
    edges.forEach((edge: any) => {
      expect(edge.source).toBeDefined();
      expect(edge.target).toBeDefined();
      expect(edge.label).toBeDefined();
      // Label: "X.X/m" for flows, "plant ×N" for nursery seeds (a one-time count)
      expect(edge.label).toMatch(/[\d.]+\/m|^plant ×\d+$/);
    });

    // Should have edge to target node (edges go from child to parent)
    const targetNode = nodes.find((n: any) => n.data.isTarget);
    const edgesToTarget = edges.filter(
      (e: any) => e.target === targetNode.id,
    );
    expect(edgesToTarget.length).toBeGreaterThan(0);
  });

  test("should not duplicate nodes for same item", async () => {
    const config: PlannerConfig = {
      targets: [{ item: "Basic Fertilizer", rate: 10 }],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Logs",
      selectedFertilizer: "",
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes } = await generateGraph(productionTrees);

    // Check for duplicate node IDs
    const nodeIds = nodes.map((n: any) => n.id);
    const uniqueNodeIds = new Set(nodeIds);
    expect(nodeIds.length).toBe(uniqueNodeIds.size);

    // Check that Logs appears only once as a raw material
    const logsNodes = nodes.filter((n: any) => n.data.itemName === "Logs");
    expect(logsNodes).toHaveLength(1);
  });

  test("should include device counts in production nodes", async () => {
    const config: PlannerConfig = {
      targets: [{ item: "Plank", rate: 10 }],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Coal",
      selectedFertilizer: "",
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes } = await generateGraph(productionTrees);

    // Find production node for Plank (not the target node)
    const plankProdNode = nodes.find(
      (n: any) => !n.data.isTarget && !n.data.isRaw && n.data.itemName === "Plank",
    );

    expect(plankProdNode).toBeDefined();
    expect(plankProdNode.data.deviceCount).toBeGreaterThan(0);
    expect(plankProdNode.data.deviceId).toBe("table-saw");
  });

  test("should include parent furnace info for heated devices", async () => {
    const config: PlannerConfig = {
      targets: [{ item: "Quicklime", rate: 10 }],
      availableResources: [],
      fuelEfficiency: 0,
      alchemySkill: 0,
      factoryEfficiency: 0,
      logisticsEfficiency: 0,
      throwingEfficiency: 0,
      fertilizerEfficiency: 0,
      salesAbility: 0,
      negotiationSkill: 0,
      customerMgmt: 0,
      relicKnowledge: 0,
      selectedFuel: "Logs",
      selectedFertilizer: "",
    };

    const productionTrees = calculateProductionLP(config);
    const { nodes } = await generateGraph(productionTrees);

    // Find production node for Quicklime (uses Crucible, which requires furnace)
    const quicklimeNode = nodes.find(
      (n: any) => !n.data.isTarget && !n.data.isRaw && n.data.itemName === "Quicklime",
    );

    expect(quicklimeNode).toBeDefined();
    expect(quicklimeNode.data.deviceId).toBe("crucible");
    expect(quicklimeNode.data.parentFurnaceId).toBeDefined();
    expect(quicklimeNode.data.parentFurnaceCount).toBeGreaterThan(0);
  });
});

describe("Graph Mapper - edge integrity", () => {
  test("every edge endpoint is a node, even when a byproduct is fully recycled (Steel's Iron Ingot)", async () => {
    const config = {
      targets: [{ item: "Steel Ingot", rate: 30 }, { item: "Iron Nails", rate: 30 }], availableResources: [],
      fuelEfficiency: 0, alchemySkill: 0, factoryEfficiency: 0, logisticsEfficiency: 0, throwingEfficiency: 0,
      fertilizerEfficiency: 0, salesAbility: 0, negotiationSkill: 0, customerMgmt: 0, relicKnowledge: 0,
      selectedFuel: "coal", selfFuel: false,
    } as PlannerConfig;
    const { nodes, edges } = await generateGraph(calculateProductionLP(config));
    const ids = new Set(nodes.map((n) => n.id));
    const dangling = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target)).map((e) => e.id);
    expect(dangling).toEqual([]);
  });
});

describe("Graph Mapper - split target", () => {
  test("two recipes making the target feed one target node carrying the full rate", async () => {
    const { nodes } = await generateGraph(calculateProductionLP({
      targets: [{ item: "Coke", rate: 100 }], availableResources: [],
      fuelEfficiency: 0, alchemySkill: 0, factoryEfficiency: 0, logisticsEfficiency: 0, throwingEfficiency: 0,
      fertilizerEfficiency: 0, salesAbility: 0, negotiationSkill: 0, customerMgmt: 0, relicKnowledge: 0, selectedFuel: "",
      recipeSplits: { coke: { coke: 60, coke_alt: 40 } },
    } as PlannerConfig));
    const targets = nodes.filter((n) => (n.data as { isTarget?: boolean }).isTarget);
    expect(targets).toHaveLength(1);
    expect((targets[0].data as { rate: number }).rate).toBeCloseTo(100, 3);
  });
});
