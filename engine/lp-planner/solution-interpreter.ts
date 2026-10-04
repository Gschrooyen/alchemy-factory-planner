import { Solution } from "yalps";
import { PlannerConfig, ProductionNode, Recipe } from "../types";
import { EfficiencyContext, EPSILON } from "./types";
import { getItem, getDevice, getRecipeById, getAllRecipes, recipeHeatSpeed } from "./model-builder";
import { getOutputMultiplier } from "./efficiency";
import { normalizeItemId, getEffectiveRecipeTime as effectiveRecipeTime, resolveMachineName, isNurseryMachine, recipeNutrients } from "../item-utils";

/** Nursery cycle time depends on the selected fertilizer (see item-utils). */
function getEffectiveRecipeTime(recipe: Recipe, ctx: EfficiencyContext): number {
  return effectiveRecipeTime(recipe, ctx.selectedFertilizer, ctx.fertilizerMultiplier, ctx.beltLimit, ctx.speedMultiplier);
}

/** Per item, what a recipe hands straight back to itself (e.g. the Athanor's Iron Ingot from making steel):
 *  min(output, input) of the same item. The machine loops it into its own input, so it's neither a
 *  byproduct nor an input drawn from elsewhere. Same netting the LP model does per recipe. */
function selfRecycled(recipe: Recipe, activationRate: number, machineName: string, ctx: EfficiencyContext): Map<string, number> {
  const recycled = new Map<string, number>();
  recipe.outputs.forEach((output) => {
    const itemId = output.id || normalizeItemId(output.name);
    const inCount = recipe.inputs
      .filter((i) => (i.id || normalizeItemId(i.name)) === itemId)
      .reduce((sum, i) => sum + i.count, 0);
    if (!inCount) return;
    const count = typeof output.count === "string" ? parseFloat(output.count) : output.count;
    const pct = output.percentage ? (typeof output.percentage === "string" ? parseFloat(output.percentage) : output.percentage) : 100;
    const out = activationRate * count * (pct / 100) * getOutputMultiplier(machineName, ctx);
    recycled.set(itemId, (recycled.get(itemId) ?? 0) + Math.min(out, activationRate * inCount));
  });
  return recycled;
}

interface ItemFlow {
  produced: number;
  consumed: number;
  burned: number; // part of `consumed` that is fuel for heat
  sources: Array<{ recipeId: string; rate: number }>;
  consumers: Array<{ recipeId: string; rate: number }>;
}

/**
 * Interpret LP solution and convert to ProductionNode[] format.
 * This creates a tree structure compatible with the existing graphMapper.
 */
export function interpretSolution(
  solution: Solution<string>,
  config: PlannerConfig,
  ctx: EfficiencyContext
): ProductionNode[] {
  if (solution.status !== "optimal") {
    console.warn("[LP Planner] No optimal solution found:", solution.status);
    return [];
  }

  // Extract active recipes and raw material purchases
  const recipeActivations = new Map<string, number>();
  const rawPurchases = new Map<string, number>();
  const supplied = new Map<string, number>(); // itemId -> items/min drawn from the user's available resources
  const burned = new Map<string, number>(); // fuelId -> items/min burned for heat (burnByproducts mode)
  const built = new Map<string, number>(); // whole-machine mode: recipeId -> machines built (some may idle)
  let scale = 1; // whole-machine mode: targets were scaled up to fill the machines (the target is a minimum)

  // solution.variables is an array of [varName, value] tuples
  for (const [varName, value] of solution.variables) {
    if (value < EPSILON) continue;

    if (varName.startsWith("recipe_")) {
      const recipeId = varName.slice(7); // Remove "recipe_" prefix
      recipeActivations.set(recipeId, value);
    } else if (varName.startsWith("raw_")) {
      const itemName = varName.slice(4); // Remove "raw_" prefix
      rawPurchases.set(itemName, value);
    } else if (varName.startsWith("burn_")) {
      burned.set(varName.slice(5), value);
    } else if (varName.startsWith("supply_")) {
      supplied.set(varName.slice(7), value);
    } else if (varName.startsWith("machines_")) {
      built.set(varName.slice(9), Math.round(value));
    } else if (varName === "scale") {
      scale = value;
    }
  }

  // Which fuels supply heat, and what fraction of total heat each provides.
  // Without burnByproducts this is just the selected fuel at 100%.
  const fuelShares: FuelShare[] = [];
  if (burned.size > 0) {
    let totalHeat = 0;
    burned.forEach((rate, fuelId) => { totalHeat += rate * (getItem(fuelId)?.heat_value || 0); });
    burned.forEach((rate, fuelId) => {
      fuelShares.push({ fuelId, share: (rate * (getItem(fuelId)?.heat_value || 0)) / totalHeat });
    });
  } else {
    fuelShares.push({ fuelId: normalizeItemId(ctx.selectedFuel), share: 1 });
  }

  // Calculate item flows to understand production network
  const itemFlows = calculateItemFlows(recipeActivations, ctx, fuelShares);

  // Build production nodes for each active recipe's primary output
  const productionNodes = new Map<string, ProductionNode>();

  // Create nodes for each active recipe
  recipeActivations.forEach((activationRate, recipeId) => {
    const recipe = getRecipeById(recipeId);
    if (!recipe) return;

    const machineName = resolveMachineName(recipe.crafted_in, ctx.useThermalExtractor);
    const device = getDevice(machineName);

    // Calculate machine count
    // activationRate is recipes per minute
    // Each machine completes 1 recipe every (time / speedMultiplier) seconds
    // So machines needed = activationRate * (time / 60 / speedMultiplier)
    const effectiveRecipeTime = getEffectiveRecipeTime(recipe, ctx);
    const effectiveTime = effectiveRecipeTime / ctx.speedMultiplier;
    const machineCount = activationRate * (effectiveTime / 60);

    // Find primary output (first output)
    const primaryOutput = recipe.outputs[0];
    const primaryOutputId = primaryOutput.id || normalizeItemId(primaryOutput.name);
    const primaryOutputItem = getItem(primaryOutputId);

    // Calculate output rates, net of what the machine feeds back into itself
    const recycled = selfRecycled(recipe, activationRate, machineName, ctx);
    const outputRates = new Map<string, number>();
    recipe.outputs.forEach((output) => {
      const count = typeof output.count === "string" ? parseFloat(output.count) : output.count;
      const percentage = output.percentage
        ? (typeof output.percentage === "string" ? parseFloat(output.percentage) : output.percentage)
        : 100;
      const rate = activationRate * count * (percentage / 100) * getOutputMultiplier(machineName, ctx);
      const outputId = output.id || normalizeItemId(output.name);
      outputRates.set(outputId, rate - (recycled.get(outputId) ?? 0));
    });

    // Calculate byproducts (all outputs except primary) - use proper names from items data
    const byproducts = recipe.outputs.slice(1).map((output) => {
      const outputId = output.id || normalizeItemId(output.name);
      const outputItem = getItem(outputId);
      return {
        itemName: outputItem?.name || output.name,
        rate: outputRates.get(outputId) || 0,
        ...(recycled.get(outputId) && { recycled: recycled.get(outputId) }),
      };
    });

    // Calculate heat consumption and parent furnace requirements
    let heatConsumption = 0;
    let parentFurnaceId: string | undefined;
    let parentFurnaceCount: number | undefined;

    const heatSpeed = recipeHeatSpeed(recipe, device);
    if (heatSpeed) {
      // Get parent furnace information
      const parentFurnace = device?.parent ? getDevice(device.parent) : null;
      const furnaceHeat = parentFurnace?.heat_self || 1; // Default to Stone Stove (1 P/s)
      const furnaceSlots = parentFurnace?.slots || 9; // Default to Stone Stove (9 slots)
      const deviceSlotsRequired = device?.slots_required || 1;

      // Calculate furnaces needed for this many machines
      // Each furnace has furnaceSlots, each device uses deviceSlotsRequired slots
      const slotsPerDevice = deviceSlotsRequired;
      const devicesPerFurnace = furnaceSlots / slotsPerDevice;
      const furnacesNeeded = Math.ceil(machineCount / devicesPerFurnace - 0.0001); // Small epsilon to handle floating point

      // Total heat per second = (furnaces × furnaceHeat + machines × deviceHeat) × speedMult
      const totalHeatPerSecond = (furnacesNeeded * furnaceHeat + machineCount * heatSpeed) * ctx.speedMultiplier;

      // Convert to heat per minute for display
      heatConsumption = totalHeatPerSecond * 60;

      // Store parent furnace information
      if (parentFurnace) {
        parentFurnaceId = parentFurnace.id;
        parentFurnaceCount = furnacesNeeded;
      }
    }

    const nodeId = `${primaryOutputId}-prod-${recipeId}`;
    const node: ProductionNode = {
      id: nodeId,
      itemName: primaryOutputItem?.name || primaryOutput.name,
      rate: outputRates.get(primaryOutputId) || 0,
      isRaw: false,
      recipeId: recipe.id,
      deviceId: device?.id,
      deviceCount: built.get(recipeId) ?? machineCount, // heat above follows actual running time
      heatConsumption,
      parentFurnaceId,
      parentFurnaceCount,
      inputs: [], // Will be linked later
      byproducts,
      beltLimit: ctx.beltLimit,
      isBeltSaturated: (outputRates.get(primaryOutputId) || 0) > ctx.beltLimit,
    };

    productionNodes.set(nodeId, node);
  });

  // Create raw material nodes from LP solution
  rawPurchases.forEach((rate, itemName) => {
    if (rate < EPSILON) return;

    const item = getItem(itemName);
    const nodeId = `${itemName}-raw`;
    const node: ProductionNode = {
      id: nodeId,
      itemName: item?.name || itemName,
      rate,
      isRaw: true,
      deviceCount: 0,
      heatConsumption: 0,
      inputs: [],
      byproducts: [],
      beltLimit: ctx.beltLimit,
      isBeltSaturated: rate > ctx.beltLimit,
    };

    productionNodes.set(nodeId, node);
  });

  // Create raw material nodes for available resources (even if item can be produced)
  // The LP model doesn't create raw_ variables for producible items, so we add them manually
  config.availableResources?.forEach((res) => {
    const itemId = normalizeItemId(res.item);
    const nodeId = `${itemId}-raw`;
    const used = supplied.get(itemId) ?? 0; // what the plan actually draws, not the whole allowance

    // Only create if not already created from rawPurchases
    if (!productionNodes.has(nodeId) && used > EPSILON) {
      const item = getItem(itemId);
      const node: ProductionNode = {
        id: nodeId,
        itemName: item?.name || res.item,
        rate: used,
        isRaw: true,
        deviceCount: 0,
        heatConsumption: 0,
        inputs: [],
        byproducts: [],
        beltLimit: ctx.beltLimit,
        isBeltSaturated: used > ctx.beltLimit,
        suppliedRate: used, // Mark as supplied resource
      };

      productionNodes.set(nodeId, node);
    }
  });

  // Create raw material nodes for seeds (not in LP model but needed for IO summary)
  recipeActivations.forEach((activationRate, recipeId) => {
    const recipe = getRecipeById(recipeId);
    if (!recipe) return;

    const machineName = resolveMachineName(recipe.crafted_in, ctx.useThermalExtractor);
    if (machineName !== "nursery") return;

    recipe.inputs.forEach((input) => {
      const itemId = input.id || normalizeItemId(input.name);
      const item = getItem(itemId);
      if (!item || !item.name.toLowerCase().endsWith(" seeds")) return;

      const nodeId = `${itemId}-raw`;
      // Only create if not already exists
      if (!productionNodes.has(nodeId)) {
        const seedRate = 0; // per consumer: one planting per nursery, set when linking (see linkProductionNodes)
        const node: ProductionNode = {
          id: nodeId,
          itemName: item.name,
          rate: seedRate,
          isRaw: true,
          deviceCount: 0,
          heatConsumption: 0,
          inputs: [],
          byproducts: [],
          beltLimit: ctx.beltLimit,
          isBeltSaturated: seedRate > ctx.beltLimit,
          planted: true,
        };
        productionNodes.set(nodeId, node);
      }
    });
  });

  // Link nodes based on item flow (create input references)
  linkProductionNodes(productionNodes, recipeActivations, itemFlows, ctx, fuelShares);

  // Byproducts: rate is gross, remaining is what is LEFT after internal use (e.g. planks burned for heat)
  productionNodes.forEach((node) => {
    node.byproducts.forEach((bp) => {
      const flow = itemFlows.get(normalizeItemId(bp.itemName));
      bp.remaining = flow && flow.produced > EPSILON
        ? bp.rate * Math.max(0, flow.produced - flow.consumed) / flow.produced
        : bp.rate;
    });
  });

  // Find and return target roots
  const targets = config.targets?.length
    ? config.targets
    : config.targetItem && config.targetRate
      ? [{ item: config.targetItem, rate: config.targetRate }]
      : [];

  // Surplus: produced beyond internal consumption and targets (from machine overrides)
  itemFlows.forEach((flow, itemId) => {
    const targetRate = targets
      .filter((t) => normalizeItemId(t.item) === itemId)
      .reduce((sum, t) => sum + t.rate, 0) * scale;
    const surplus = flow.produced - flow.consumed - targetRate;
    if (surplus <= EPSILON) return;
    // ponytail: attach to the first producing node; per-recipe split not needed for display
    const producer = flow.sources[0] && productionNodes.get(`${itemId}-prod-${flow.sources[0].recipeId}`);
    if (producer) producer.surplus = surplus;
  });

  const roots: ProductionNode[] = [];
  targets.forEach((target) => {
    const targetItemId = normalizeItemId(target.item);
    const targetItem = getItem(targetItemId);
    const targetItemName = targetItem?.name || target.item;

    // Find the production node(s) for this target. Several recipes can make it (a split, or two brews the
    // solver picked): each gets its share of the item's net output, not the whole of it
    const makers = [...productionNodes.values()].filter((n) => n.itemName === targetItemName && !n.isRaw);
    const makersRate = makers.reduce((sum, n) => sum + n.rate, 0);
    makers.forEach((node) => {
      // Calculate NET output rate (produced - consumed internally)
      // This shows actual output available, not gross production
      const flow = itemFlows.get(targetItemId);
      // Bought units of the item (only ever fuel) cover consumption before produced ones do
      const bought = rawPurchases.get(targetItemId) || 0;
      const share = makersRate > EPSILON ? node.rate / makersRate : 1 / makers.length;
      const netRate = flow ? (flow.produced - Math.max(0, flow.consumed - bought)) * share : node.rate;

      // Create a copy with netOutputRate set for the target edge
      // Keep rate as gross production for the node display
      const rootNode: ProductionNode = {
        ...node,
        netOutputRate: netRate,
      };
      roots.push(rootNode);
    });
  });

  // Production that doesn't feed any target (e.g. machines run only to use up a byproduct)
  // would otherwise be invisible: surface it as extra roots.
  const reachable = new Set<string>();
  const seen = new Set<ProductionNode>(); // consumption refs share ids with their source, so dedupe by object
  const visit = (n: ProductionNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    if (n.id) reachable.add(n.id);
    n.inputs.forEach(visit);
  };
  roots.forEach(visit);
  productionNodes.forEach((node) => {
    if (node.isRaw || !node.id || reachable.has(node.id)) return;
    const flow = itemFlows.get(normalizeItemId(node.itemName));
    roots.push({ ...node, isOrphanRoot: true, netOutputRate: flow ? flow.produced - flow.consumed : node.rate });
    visit(node);
  });

  // If no roots found, something went wrong - return empty
  if (roots.length === 0) {
    console.warn("[LP Planner] No root nodes found for targets");
    return [];
  }

  return roots;
}

/**
 * Calculate item flows from active recipes
 */
interface FuelShare { fuelId: string; share: number }

function calculateItemFlows(
  recipeActivations: Map<string, number>,
  ctx: EfficiencyContext,
  fuelShares: FuelShare[]
): Map<string, ItemFlow> {
  const flows = new Map<string, ItemFlow>();

  const getOrCreateFlow = (itemName: string): ItemFlow => {
    if (!flows.has(itemName)) {
      flows.set(itemName, {
        produced: 0,
        consumed: 0,
        burned: 0,
        sources: [],
        consumers: [],
      });
    }
    return flows.get(itemName)!;
  };

  recipeActivations.forEach((activationRate, recipeId) => {
    const recipe = getRecipeById(recipeId);
    if (!recipe) return;

    const machineName = resolveMachineName(recipe.crafted_in, ctx.useThermalExtractor);
    const recycled = selfRecycled(recipe, activationRate, machineName, ctx);

    // Track outputs (net of self-recycling, so the loop doesn't show up as a shareable byproduct)
    recipe.outputs.forEach((output) => {
      const itemId = output.id || normalizeItemId(output.name);
      const flow = getOrCreateFlow(itemId);

      const count = typeof output.count === "string" ? parseFloat(output.count) : output.count;
      const percentage = output.percentage
        ? (typeof output.percentage === "string" ? parseFloat(output.percentage) : output.percentage)
        : 100;
      const rate = activationRate * count * (percentage / 100) * getOutputMultiplier(machineName, ctx) - (recycled.get(itemId) ?? 0);
      // Fully recycled (steel's Iron Ingot): not a source anyone else can draw from
      if (rate < EPSILON) return;

      flow.produced += rate;
      flow.sources.push({ recipeId, rate });
    });

    // Track inputs
    // Note: Skip seed inputs for nursery recipes (seeds aren't consumed)
    const isNurseryRecipe = isNurseryMachine(machineName);

    recipe.inputs.forEach((input) => {
      const itemId = input.id || normalizeItemId(input.name);
      const item = getItem(itemId);

      // Skip seed inputs for nursery recipes
      if (isNurseryRecipe && item?.name.toLowerCase().endsWith(" seeds")) {
        return;
      }

      const flow = getOrCreateFlow(itemId);
      const rate = activationRate * input.count - (recycled.get(itemId) ?? 0);
      if (rate < EPSILON) return;

      flow.consumed += rate;
      flow.consumers.push({ recipeId, rate });
    });

    // Track nursery fertilizer consumption
    const device = getDevice(machineName);
    const isNursery = isNurseryMachine(machineName);

    if (isNursery && ctx.selectedFertilizer) {
      const fertilizerId = normalizeItemId(ctx.selectedFertilizer);
      const fertilizerItem = getItem(fertilizerId);
      const outputDef = recipe.outputs[0];
      const outputId = outputDef?.id || (outputDef ? normalizeItemId(outputDef.name) : "");
      const outputItem = outputId ? getItem(outputId) : null;

      if (fertilizerItem?.nutrient_value && outputItem?.required_nutrients) {
        const flow = getOrCreateFlow(fertilizerId);

        // Fertilizer consumption: nutrients are per OUTPUT ITEM, not per cycle
        // Each Flax needs 24 nutrients, so per cycle (200 Flax) = 200 * 24 nutrients
        const outputCount = typeof recipe.outputs[0].count === "string"
          ? parseFloat(recipe.outputs[0].count)
          : recipe.outputs[0].count;
        const effectiveNutrientValue = fertilizerItem.nutrient_value * ctx.fertilizerMultiplier; // research boosts value per unit
        const fertilizerPerActivation = recipeNutrients(recipe) / effectiveNutrientValue; // all outputs (leaf + core)
        const rate = activationRate * fertilizerPerActivation;

        flow.consumed += rate;
        flow.consumers.push({ recipeId, rate });
      }
    }

    // Track fuel consumption (parent/child relationship)
    const heatSpeed = recipeHeatSpeed(recipe, device);
    if (heatSpeed) {
      fuelShares.forEach(({ fuelId, share }) => {
      const fuelItem = getItem(fuelId);
      if (fuelItem?.heat_value) {
        const flow = getOrCreateFlow(fuelId);

        // Get parent furnace information
        const parentFurnace = device?.parent ? getDevice(device.parent) : null;
        const furnaceHeat = parentFurnace?.heat_self || 1; // Default to Stone Stove (1 P/s)
        const furnaceSlots = parentFurnace?.slots || 9; // Default to Stone Stove (9 slots)
        const deviceSlotsRequired = device?.slots_required || 1;

        // Heat per second calculation (must match model-builder.ts):
        // - Device consumes heat at heatSpeed P/s
        // - Device uses fraction of furnace: deviceSlotsRequired / furnaceSlots
        // - Furnace contributes: furnaceHeat × (deviceSlotsRequired / furnaceSlots) P/s
        const deviceHeatPerSecond = heatSpeed * ctx.speedMultiplier;
        const furnaceContribution = furnaceHeat * (deviceSlotsRequired / furnaceSlots) * ctx.speedMultiplier;
        const totalHeatPerSecond = deviceHeatPerSecond + furnaceContribution;

        // Heat per activation = heat per second × time per activation
        const effectiveRecipeTime = getEffectiveRecipeTime(recipe, ctx);
        const timePerActivation = effectiveRecipeTime / ctx.speedMultiplier;
        const heatPerActivation = totalHeatPerSecond * timePerActivation;
        const fuelPerActivation = heatPerActivation * share / (fuelItem.heat_value * ctx.fuelMultiplier);
        const rate = activationRate * fuelPerActivation;

        flow.consumed += rate;
        flow.burned += rate;
        flow.consumers.push({ recipeId, rate });
      }
      });
    }
  });

  return flows;
}

/**
 * Link production nodes by adding input references.
 * Uses a flat linking approach to avoid circular references.
 */
function linkProductionNodes(
  nodes: Map<string, ProductionNode>,
  recipeActivations: Map<string, number>,
  itemFlows: Map<string, ItemFlow>,
  ctx: EfficiencyContext,
  fuelShares: FuelShare[]
): void {
  // Track which node IDs we've already added as inputs to prevent duplicates
  const addedInputs = new Map<string, Set<string>>(); // nodeId -> Set of input nodeIds

  // Track dependencies as we build them for cycle detection
  const dependencies = new Map<string, Set<string>>(); // nodeId -> all its dependencies (direct and transitive)

  // Helper to check if adding dep would create cycle
  function wouldCreateCycleNew(nodeId: string, depId: string): boolean {
    // Adding nodeId->depId creates cycle if depId already depends on nodeId
    const depDeps = dependencies.get(depId) || new Set();
    return depDeps.has(nodeId);
  }

  // Helper to add dependency and update transitive closure
  function addDependency(nodeId: string, depId: string) {
    if (!dependencies.has(nodeId)) {
      dependencies.set(nodeId, new Set());
    }
    const nodeDeps = dependencies.get(nodeId)!;

    // Add direct dependency
    nodeDeps.add(depId);

    // Add all transitive dependencies of depId
    const depDeps = dependencies.get(depId);
    if (depDeps) {
      depDeps.forEach(transitiveDep => nodeDeps.add(transitiveDep));
    }
  }

  // For each production node, find what inputs it needs
  recipeActivations.forEach((activationRate, recipeId) => {
    const recipe = getRecipeById(recipeId);
    if (!recipe) return;

    const primaryOutput = recipe.outputs[0];
    const primaryOutputId = primaryOutput.id || normalizeItemId(primaryOutput.name);
    const nodeId = `${primaryOutputId}-prod-${recipeId}`;
    const node = nodes.get(nodeId);
    if (!node) return;

    const machineName = resolveMachineName(recipe.crafted_in, ctx.useThermalExtractor);
    const recycled = selfRecycled(recipe, activationRate, machineName, ctx);

    if (!addedInputs.has(nodeId)) {
      addedInputs.set(nodeId, new Set());
    }
    const nodeInputs = addedInputs.get(nodeId)!;

    // Link each input to its source
    // Note: Seeds for nursery recipes aren't consumed per activation in LP model,
    // but we still link them for IO summary visibility
    recipe.inputs.forEach((input) => {
      const inputId = input.id || normalizeItemId(input.name);
      // What the machine loops back to itself isn't drawn from any source
      const inputRate = activationRate * input.count - (recycled.get(inputId) ?? 0);
      if (inputRate < EPSILON) return;

      // Find the source node for this input
      const flow = itemFlows.get(inputId);
      if (flow && flow.sources.length > 0) {
        // Link to production source(s)
        flow.sources.forEach((source) => {
          const sourceRecipe = getRecipeById(source.recipeId);
          if (!sourceRecipe) return;
          const sourceOutput = sourceRecipe.outputs[0];
          const sourceOutputId = sourceOutput.id || normalizeItemId(sourceOutput.name);
          const sourceNodeId = `${sourceOutputId}-prod-${source.recipeId}`;
          const sourceNode = nodes.get(sourceNodeId);

          // Skip if already added or would create self-reference. Keyed per item, not per source: one
          // recipe can feed two different items to the same consumer (Gentian + Gentian Nectar from one nursery)
          const linkKey = `${sourceNodeId}|${inputId}`;
          if (!sourceNode || sourceNodeId === nodeId || nodeInputs.has(linkKey)) return;

          nodeInputs.add(linkKey);
          // Each consumer gets its own reference carrying ITS share of the flow, so edge labels
          // show consumption rather than the source's gross production. Byproduct inputs hang
          // off the byproduct node (id must match graphMapper).
          const share = flow.produced > EPSILON ? source.rate / flow.produced : 1;
          const inputName = getItem(inputId)?.name || input.name;
          node.inputRates = node.inputRates || {};
          node.inputRates[inputName] = (node.inputRates[inputName] || 0) + inputRate * share;
          if (sourceOutputId !== inputId) {
            const ref = createConsumptionReference(sourceNode, inputRate * share, inputId);
            ref.id = `${sourceNodeId}-byproduct-${inputName}`;
            ref.itemName = inputName;
            node.inputs.push(ref);
          } else {
            node.inputs.push(sourceNode);
          }
          addDependency(nodeId, sourceNodeId);
        });
      } else {
        // Link to raw material
        const rawNodeId = `${inputId}-raw`;
        const rawNode = nodes.get(rawNodeId);
        if (rawNode && !nodeInputs.has(rawNodeId)) {
          nodeInputs.add(rawNodeId);
          // Seeds are planted once per nursery, not used up per cycle: the "rate" is how many to plant
          const rate = rawNode.planted ? plantedSeeds(node.deviceCount, input.count) : inputRate;
          node.inputs.push(createInputReference(rawNode, rate, inputId));
          addDependency(nodeId, rawNodeId);
        }
      }
    });

    // Link fertilizer input if nursery
    const device = getDevice(machineName);
    const isNursery = isNurseryMachine(machineName);

    if (isNursery && ctx.selectedFertilizer) {
      const fertilizerItem = getItem(ctx.selectedFertilizer);
      const outputItem = recipe.outputs[0]
        ? getItem(recipe.outputs[0].name)
        : null;

      if (fertilizerItem?.nutrient_value && outputItem?.required_nutrients) {
        const fertId = normalizeItemId(ctx.selectedFertilizer);
        const fertFlow = itemFlows.get(fertId);

        // Fertilizer consumption: nutrients are per OUTPUT ITEM, not per cycle
        const outputCount = typeof recipe.outputs[0].count === "string"
          ? parseFloat(recipe.outputs[0].count)
          : recipe.outputs[0].count;
        const fertilizerPerActivation = recipeNutrients(recipe) / (fertilizerItem.nutrient_value * ctx.fertilizerMultiplier);
        const fertilizerRate = activationRate * fertilizerPerActivation;

        // Link fertilizer (production sources)
        if (fertFlow && fertFlow.sources.length > 0) {
          // Calculate how much comes from production vs raw (if raw is available)
          const rawFertRate = nodes.get(`${fertId}-raw`)?.rate || 0;
          const totalFertAvailable = fertFlow.produced + rawFertRate;
          const prodPortion = totalFertAvailable > 0 ? fertFlow.produced / totalFertAvailable : 1;

          // Fertilizer is produced - link to production nodes
          // Note: We create consumption references even for cycles so they appear in the graph
          fertFlow.sources.forEach(({ recipeId, rate: sourceRate }) => {
            const sourceNodeId = `${fertId}-prod-${recipeId}`;
            const sourceNode = nodes.get(sourceNodeId);
            // Calculate consumption rate from this production source, scaled by production portion
            const inputRate = fertilizerRate * (sourceRate / fertFlow.produced) * prodPortion;

            if (!sourceNode || sourceNodeId === nodeId || nodeInputs.has(`fertilizer:${sourceNodeId}`)) return;

            // Check for cycles - if detected, still create the link but don't add to dependencies
            // This allows the graph to show circular fertilizer flows without breaking traversal
            const wouldCycle = wouldCreateCycleNew(nodeId, sourceNodeId);

            nodeInputs.add(`fertilizer:${sourceNodeId}`);
            // Use consumption reference to show edge without inflating production rate
            node.inputs.push({ ...createConsumptionReference(sourceNode, inputRate, fertId), inputKind: "fertilizer" });

            // Only track dependencies if not cyclic to avoid infinite loops in traversal
            if (!wouldCycle) {
              addDependency(nodeId, sourceNodeId);
            }
          });
        }

        // Link fertilizer (raw/purchased source if available)
        // This allows showing both produced AND raw sources when both exist
        const rawNodeId = `${fertId}-raw`;
        const rawNode = nodes.get(rawNodeId);
        if (rawNode && !nodeInputs.has(`fertilizer:${rawNodeId}`)) {
          // Calculate how much raw fertilizer this node consumes
          // If there's also production, the raw portion is proportional to raw supply
          const rawFertRate = rawNode.rate;
          const totalFertAvailable = (fertFlow?.produced || 0) + rawFertRate;
          const rawPortion = totalFertAvailable > 0 ? rawFertRate / totalFertAvailable : 1;
          const rawInputRate = fertilizerRate * rawPortion;

          nodeInputs.add(`fertilizer:${rawNodeId}`);
          node.inputs.push({ ...createInputReference(rawNode, rawInputRate, fertId), inputKind: "fertilizer" });
          addDependency(nodeId, rawNodeId);
        }
      }
    }

    // Link fuel input if applicable
    const heatSpeed = recipeHeatSpeed(recipe, device);
    if (heatSpeed) {
      fuelShares.forEach(({ fuelId, share }) => {
      const fuelItem = getItem(fuelId);
      if (fuelItem?.heat_value) {
        const fuelFlow = itemFlows.get(fuelId);

        // Get parent furnace information for heat calculation
        const parentFurnace = device?.parent ? getDevice(device.parent) : null;
        const furnaceHeat = parentFurnace?.heat_self || 1;
        const furnaceSlots = parentFurnace?.slots || 9;
        const deviceSlotsRequired = device?.slots_required || 1;

        // Calculate fuel consumption using parent/child heat formula
        const deviceHeatPerSecond = heatSpeed * ctx.speedMultiplier;
        const furnaceContribution = furnaceHeat * (deviceSlotsRequired / furnaceSlots) * ctx.speedMultiplier;
        const totalHeatPerSecond = deviceHeatPerSecond + furnaceContribution;
        const effectiveRecipeTime = getEffectiveRecipeTime(recipe, ctx);
        const timePerActivation = effectiveRecipeTime / ctx.speedMultiplier;
        const heatPerActivation = totalHeatPerSecond * timePerActivation;
        const fuelRate = activationRate * heatPerActivation * share / (fuelItem.heat_value * ctx.fuelMultiplier);

        // Link fuel (production sources)
        if (fuelFlow && fuelFlow.sources.length > 0) {
          // Bought fuel covers heat first (the LP only buys a producible fuel to burn it); production covers the rest
          const rawFuelRate = nodes.get(`${fuelId}-raw`)?.rate || 0;
          const prodPortion = 1 - Math.min(1, fuelFlow.burned > 0 ? rawFuelRate / fuelFlow.burned : 0);

          // Fuel is produced - link to production nodes
          // Note: We create consumption references even for cycles so they appear in the graph
          fuelFlow.sources.forEach(({ recipeId, rate: sourceRate }) => {
            // Fuel may be the source recipe's primary output or a byproduct (e.g. Plank from sawing Rotten Log)
            const sourceRecipe = getRecipeById(recipeId);
            const sourcePrimaryId = sourceRecipe ? (sourceRecipe.outputs[0].id || normalizeItemId(sourceRecipe.outputs[0].name)) : fuelId;
            const sourceNodeId = `${sourcePrimaryId}-prod-${recipeId}`;
            const sourceNode = nodes.get(sourceNodeId);
            // Calculate consumption rate from this production source, scaled by production portion
            const inputRate = fuelRate * (sourceRate / fuelFlow.produced) * prodPortion;

            if (!sourceNode || sourceNodeId === nodeId || nodeInputs.has(`fuel:${sourceNodeId}`)) return;

            // Check for cycles - if detected, still create the link but don't add to dependencies
            // This allows the graph to show circular fuel flows without breaking traversal
            const wouldCycle = wouldCreateCycleNew(nodeId, sourceNodeId);

            nodeInputs.add(`fuel:${sourceNodeId}`);
            // Use consumption reference to show edge without inflating production rate
            const ref = createConsumptionReference(sourceNode, inputRate, fuelId);
            if (sourcePrimaryId !== fuelId) {
              // Byproduct fuel: edge should leave the byproduct node (id must match graphMapper)
              ref.id = `${sourceNodeId}-byproduct-${fuelItem.name}`;
              ref.itemName = fuelItem.name;
            }
            ref.inputKind = "fuel";
            node.inputs.push(ref);

            // Only track dependencies if not cyclic to avoid infinite loops in traversal
            if (!wouldCycle) {
              addDependency(nodeId, sourceNodeId);
            }
          });
        }

        // Link fuel (raw/purchased source if available)
        // This allows showing both produced AND raw sources when both exist
        const rawNodeId = `${fuelId}-raw`;
        const rawNode = nodes.get(rawNodeId);
        if (rawNode && !nodeInputs.has(`fuel:${rawNodeId}`)) {
          // Bought fuel covers heat first; only the shortfall comes from production
          const burned = fuelFlow?.burned || 0;
          const rawPortion = burned > 0 ? Math.min(1, rawNode.rate / burned) : 1;
          const rawInputRate = fuelRate * rawPortion;

          nodeInputs.add(`fuel:${rawNodeId}`);
          node.inputs.push({ ...createInputReference(rawNode, rawInputRate, fuelId), inputKind: "fuel" });
          addDependency(nodeId, rawNodeId);
        }
      }
      });
    }
  });
}

/** Seeds to plant for a nursery group: one planting per (whole) nursery. */
export function plantedSeeds(nurseries: number, seedsPerNursery: number): number {
  return Math.ceil(nurseries - 1e-6) * seedsPerNursery;
}

/**
 * Create an input reference to a source node.
 * For produced items, we return the same object reference to prevent double-counting in the graph.
 * For raw materials, we create a copy to show the specific consumption rate.
 */
function createInputReference(
  sourceNode: ProductionNode,
  inputRate: number,
  _itemName: string
): ProductionNode {
  // For raw materials, create a copy with the consumption rate
  // This allows different consumers to show different consumption amounts
  if (sourceNode.isRaw) {
    return {
      ...sourceNode,
      rate: inputRate,
      inputs: sourceNode.inputs,
    };
  }

  // For produced items, return the original node object
  // This ensures the node is only counted once when the graph deduplicates by reference
  return sourceNode;
}

/**
 * Create a consumption reference for fuel/fertilizer.
 * These are NOT visible nodes in the graph - they just create edges.
 * The graphMapper skips adding them to merged nodes but traverses their inputs.
 */
function createConsumptionReference(
  sourceNode: ProductionNode,
  consumptionRate: number,
  _itemId: string
): ProductionNode {
  return {
    ...sourceNode,
    rate: consumptionRate,
    isConsumptionReference: true,
    // Link to the actual production node so it's accessible from the tree
    inputs: [sourceNode],
  };
}
