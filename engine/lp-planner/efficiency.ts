import { PlannerConfig } from "../types";
import { EfficiencyContext, ALCHEMY_MACHINES, THERMAL_EXTRACTOR } from "./types";
import { attributeMultiplier, attributeValue } from "../attributes";

/**
 * Research bonuses, read straight from the game's DT_Attributes / DT_Improvements ladders
 * (see engine/attributes.ts). Each returns a fraction, so level 0 is 0.
 */
export function calculateAlchemyBonus(level: number): number {
  return attributeMultiplier("ExtractorSkill", level) - 1;
}

/** Catapult throughput in items/min (base 60, +15/level, +3/level past 12). */
export function calculateCatapultRate(level: number): number {
  return attributeValue("CatapultSpeed", level);
}

/** Shop profit bonus (StoreProfit: +10% per level, 4 levels). */
export function calculateSalesBonus(level: number): number {
  return attributeMultiplier("StoreProfit", level) - 1;
}

/** Quest reward bonus (QuestProfit). */
export function calculateQuestProfitBonus(level: number): number {
  return attributeMultiplier("QuestProfit", level) - 1;
}

/** Contract volume bonus (ContractNum: +60% per level, 5 levels). */
export function calculateContractBonus(level: number): number {
  return attributeValue("ContractNum", level) / 100;
}

/** Relic withdrawal bonus (AltarEfficiency: +10% per level). */
export function calculateAltarBonus(level: number): number {
  return attributeValue("AltarEfficiency", level) / 100;
}

/**
 * Build efficiency context from planner config.
 * Extracts all multipliers that affect production rates.
 */
export function buildEfficiencyContext(config: PlannerConfig): EfficiencyContext {
  // All four multipliers come from the game's own improvement ladders
  const speedMultiplier = attributeMultiplier("FactorySpeed", config.factoryEfficiency);
  const alchemyMultiplier = attributeMultiplier("ExtractorSkill", config.alchemySkill);
  const fuelMultiplier = attributeMultiplier("FuelEfficiency", config.fuelEfficiency);
  const fertilizerMultiplier = attributeMultiplier("FertilizerEfficiency", config.fertilizerEfficiency);

  const thermalYieldMultiplier = calculateThermalYieldMultiplier(config.thermalExtractorFloors ?? 0);

  const beltLimit = attributeValue("ConveyerSpeed", config.logisticsEfficiency);

  return {
    speedMultiplier,
    alchemyMultiplier,
    fuelMultiplier,
    fertilizerMultiplier,
    useThermalExtractor: config.useThermalExtractor ?? false,
    thermalYieldMultiplier,
    beltLimit,
    selectedFuel: config.selectedFuel || "Coal",
    selectedFertilizer: config.selectedFertilizer,
    selfFuel: config.selfFuel ?? true,
    selfFertilizer: config.selfFertilizer ?? true,
  };
}

/**
 * Check if a machine type gets the alchemy skill multiplier
 */
export function isAlchemyMachine(machineName: string): boolean {
  return ALCHEMY_MACHINES.includes(machineName.toLowerCase());
}

/**
 * Thermal Extractor yield bonus from build height.
 * Game formula (UExtractFacilityComponent::GetProductionMultiplier):
 *   output *= 1 + clamp(BuiltHeight / 128, 0, 2), BuiltHeight = grid Z units above ground
 * One storey is 16 grid Z units, so each storey is +12.5%, capped at +200% (16 storeys).
 */
export function calculateThermalYieldMultiplier(floors: number): number {
  return 1 + Math.min(2, Math.max(0, floors) * 0.125);
}

/**
 * Combined output quantity multiplier for a machine.
 * Alchemy skill applies to extractors and alembics; build height only to the Thermal Extractor.
 */
export function getOutputMultiplier(machineName: string, ctx: EfficiencyContext): number {
  const name = machineName.toLowerCase();
  const alchemy = ALCHEMY_MACHINES.includes(name) ? ctx.alchemyMultiplier : 1;
  const thermal = name === THERMAL_EXTRACTOR ? ctx.thermalYieldMultiplier : 1;
  return alchemy * thermal;
}

/**
 * Calculate items per minute for a recipe output, accounting for efficiency.
 *
 * @param outputCount - Base output count from recipe
 * @param percentage - Output percentage (for probabilistic recipes)
 * @param recipeTime - Base recipe time in seconds
 * @param machineName - Name of the crafting device
 * @param ctx - Efficiency context
 * @returns Items per minute per machine
 */
export function calculateOutputRate(
  outputCount: number,
  percentage: number,
  recipeTime: number,
  machineName: string,
  ctx: EfficiencyContext
): number {
  const effectiveCount = outputCount * (percentage / 100);

  // Items per minute = (count * yield bonuses / time) * 60 * speedMultiplier
  return (effectiveCount * getOutputMultiplier(machineName, ctx) / recipeTime) * 60 * ctx.speedMultiplier;
}

/**
 * Calculate input consumption per minute for a recipe input.
 *
 * @param inputCount - Input count required per recipe cycle
 * @param recipeTime - Base recipe time in seconds
 * @param ctx - Efficiency context
 * @returns Items per minute consumed per machine
 */
export function calculateInputRate(
  inputCount: number,
  recipeTime: number,
  ctx: EfficiencyContext
): number {
  // Inputs per minute = (count / time) * 60 * speedMultiplier
  return (inputCount / recipeTime) * 60 * ctx.speedMultiplier;
}
