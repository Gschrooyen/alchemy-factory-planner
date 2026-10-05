export type Category =
  | "raw materials"
  | "fuel"
  | "seeds"
  | "herbs"
  | "solid"
  | "mash"
  | "liquid"
  | "catalyst"
  | "magic"
  | "currency"
  | "misc."
  | "potions"
  | "jewelry"
  | "relic"
  | "fertilizer"
  | "components"
  | "automated processing"
  | "advanced crafting"
  | "heating";

export interface Item {
  id: string;
  name: string;
  category: Category | Category[];
  base_cost?: number;
  cost?: number; // Raw material cost
  heat_value?: number; // For fuels
  paradox_time?: number;
  cauldron_cost?: number;
  cauldron_target?: number;
  cauldron_coef?: number;
  cauldron_efficiency?: number;
  price?: number; // Sell price
  nutrient_value?: number; // For fertilizers
  nutrients_per_seconds?: number;
  required_nutrients?: number; // For plants
  liquid?: boolean; // Piped only; cannot enter a cauldron
  hidden?: boolean; // In the game data but not obtainable in play (bHideInGame)
}

export interface RecipeInput {
  id?: string; // Item ID for matching (e.g., "woodboard")
  name: string; // Display name for UI (e.g., "Plank")
  count: number;
}

export interface RecipeOutput {
  id?: string; // Item ID for matching (e.g., "woodboard")
  name: string; // Display name for UI (e.g., "Plank")
  count: number | string; // Sometimes string in source? "2"
  percentage?: number | string; // "50"
}

export interface Recipe {
  id: string;
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  time: number;
  crafted_in: string; // Device ID or Name
  category?: string | string[];
  heat_per_second?: number; // Overrides the device's heat draw (cauldron brews: heat depends on the product)
}

export interface Device {
  id: string;
  name: string;
  category: string;
  heat_consuming_speed?: number;
  heat_self?: number; // For furnaces: heat generated per second
  slots?: number; // For furnaces: number of device slots available
  parent?: string; // For heated devices: parent furnace device ID
  slots_required?: number; // For heated devices: slots consumed in parent
  description?: string; // In-game description
  build_cost?: { id: string; count: number }[]; // Materials to build one (item ids)
}

export interface ProductionNode {
  id?: string; // Unique identifier for graph separation
  itemName: string;
  rate: number; // Items per minute (gross production)
  netOutputRate?: number; // Net output after internal consumption (for loops)
  isConsumptionReference?: boolean; // True if this is a fuel/fertilizer consumption reference
  inputKind?: "fuel" | "fertilizer";
  inputRates?: Record<string, number>; // itemName -> rate THIS node consumes (edge labels; inputs share node objects) // Set on input references so the graph can separate heat from product inputs
  isRaw: boolean;
  recipeId?: string;
  deviceId?: string;
  deviceCount: number;
  heatConsumption: number;
  parentFurnaceId?: string; // Parent furnace device ID (e.g., "stone-stove")
  parentFurnaceCount?: number; // Number of parent furnaces needed
  inputs: ProductionNode[];
  byproducts: { itemName: string; rate: number; remaining?: number; recycled?: number }[]; // remaining = rate minus internal use; recycled = fed straight back into the same machine (not in rate)
  isBeltSaturated?: boolean;
  beltLimit?: number;
  isTarget?: boolean; // For visualization nodes
  suppliedRate?: number;
  planted?: boolean; // Nursery seeds: planted once per nursery, so `rate` is a count (seeds to build with), not per minute
  surplus?: number;
  isOrphanRoot?: boolean; // Production not feeding any target (e.g. a machine run only to burn a byproduct) // Produced beyond what the plan consumes/targets (LP only)
}

export interface PlannerConfig {
  targetItem?: string; // Optional for legacy/single compat
  targetRate?: number;
  targets: { item: string; rate: number }[]; // New multi-target support
  availableResources: { item: string; rate: number }[];

  fuelEfficiency: number; // 0-10 (Research level)
  alchemySkill: number; // 0-10 (Research level)
  factoryEfficiency: number; // 0-10 (Research level)
  logisticsEfficiency: number;
  throwingEfficiency: number;
  fertilizerEfficiency: number;
  salesAbility: number;
  negotiationSkill: number;
  customerMgmt: number;
  relicKnowledge: number;
  selectedFertilizer?: string;
  selectedFuel?: string;
  selfFuel?: boolean; // If true, fuel is produced internally; if false, treated as external input
  selfFertilizer?: boolean; // If true, fertilizer is produced internally; if false, treated as external input
  cauldronOverrides?: Record<string, string[]>; // itemId -> the 2 or 3 ingredient ids to brew it from instead of its normal recipes (LP only)
  paradoxOverrides?: Record<string, string>; // itemId (mors/vitae) -> input item id to feed the Paradox Crucible instead of its normal recipes (LP only)
  recipeOverrides?: Record<string, string>; // itemId -> the one recipe id allowed to make it; other recipes' output of it doesn't count (LP only)
  recipeSplits?: Record<string, Record<string, number>>; // itemId -> recipeId -> % of the item made by that recipe (LP only)
  optimizeFor?: "cost" | "machines"; // LP objective: cheapest raw materials (default) or fewest machines
  machineCost?: number; // Cost mode only: copper per minute charged per machine (item prices are in copper), so cheap-but-slow chains are not free (default 0 in the engine, 25 in the UI)
  useThermalExtractor?: boolean; // Run extraction recipes in the Thermal Extractor (costs heat, gains the height bonus)
  thermalExtractorFloors?: number;
  useEnhancedGrinder?: boolean; // Run grinder recipes in the Enhanced Grinder: same recipes, twice the speed (LP only) // Storeys the Thermal Extractor is built above ground: +12.5% yield each, capped at +200%
  burnByproducts?: boolean; // If true, any produced fuel-grade item may be burned for heat before buying selectedFuel (LP only)
  autoBrews?: boolean; // Brew solver: offer the LP cauldron/advanced cauldron/paradox brews that beat an item's normal recipes (LP only)
  machineOverrides?: Record<string, number>; // recipeId -> minimum machine count the user has built (LP only)
  wholeMachines?: boolean; // Integer machine counts; chain-start machines rounded up and filled, targets scaled up to match (LP only)
}

export interface ResearchState {
  logisticsEfficiency: number;
  throwingEfficiency: number; // Catapult
  factoryEfficiency: number;
  alchemySkill: number;
  fuelEfficiency: number;
  fertilizerEfficiency: number;
  salesAbility: number;
  negotiationSkill: number;
  customerMgmt: number;
  relicKnowledge: number;
}

export type PlannerMode = "recursive" | "lp";

export interface FactoryState {
  id: string;
  name: string;
  targets: { item: string; rate: number }[];
  availableResources: { item: string; rate: number }[];
  config: Omit<PlannerConfig, "targets" | "targetItem" | "targetRate" | "availableResources">;
  viewMode: "graph" | "list";
  plannerMode: PlannerMode;
}
