import itemsData from "../data/items.json";
import { Item, ProductionNode, Recipe } from "./types";

// Index data for fast lookups
const itemsMap = new Map<string, Item>();
const itemsByName = new Map<string, Item>(); // Legacy: lookup by display name

(itemsData as unknown as Item[]).forEach((item) => {
  // Primary index by ID
  itemsMap.set(item.id, item);
  // Secondary index by display name (for backwards compatibility)
  itemsByName.set(item.name.toLowerCase(), item);
});

/**
 * Normalize an item reference (name or ID) to its canonical ID
 * @param itemRef - Item name or ID
 * @returns Canonical item ID (lowercase)
 */
/**
 * Normalize a recipe's `crafted_in` to a machine name ("advanced-alembic" -> "advanced alembic").
 * With `useThermalExtractor`, extraction runs in the Thermal Extractor instead of the plain
 * Extractor: same recipes, but it burns heat and gains the build-height yield bonus.
 */
export function resolveMachineName(craftedIn: string | undefined, useThermalExtractor = false): string {
  const name = (craftedIn || "").toLowerCase().replace(/-/g, " ");
  return useThermalExtractor && name === "extractor" ? "thermal extractor" : name;
}

export function normalizeItemId(itemRef: string): string {
  // If it's already an ID in the map, return it
  if (itemsMap.has(itemRef.toLowerCase())) {
    return itemRef.toLowerCase();
  }
  // Otherwise try to find by display name
  const item = itemsByName.get(itemRef.toLowerCase());
  return item ? item.id : itemRef.toLowerCase();
}

/**
 * Get an item by its ID or name
 */
export function getItem(itemRef: string): Item | undefined {
  const itemId = normalizeItemId(itemRef);
  return itemsMap.get(itemId);
}

/**
 * Get all items
 */
export function getAllItems(): Item[] {
  return Array.from(itemsMap.values());
}

/**
 * Effective cycle time for a recipe.
 * Nursery growth is nutrient-driven: the selected fertilizer delivers
 * `nutrients_per_seconds`, and every output item needs `required_nutrients`,
 * so cycle time = total nutrients per cycle / delivery rate.
 * Falls back to recipe.time (growthSeconds) for non-nurseries or no fertilizer.
 */
/** Machines that grow plants on fertilizer: nutrient-driven cycle time, fertilizer consumed per nutrients. */
/** Trees ignore the fertilizer's own delivery rate and burn nutrient value at a flat rate (measured):
 *  World Tree Nursery 40k V/s (99 leaves + 1 core per 6M V = 150 s), Miniature World Tree 20k V/s (30k V leaves only). */
// Enhanced Grinder: "working at twice the speed of a regular one" (buildings.json), same recipes, no heat
export const ENHANCED_GRINDER_SPEED = 2;
export const TREE_NUTRIENTS_PER_SEC: Record<string, number> = { "world-tree-nursery": 40000, "miniature-world-tree": 20000 };
export const isNurseryMachine = (name: string) => /^(nursery|world[ -]tree[ -]nursery|miniature[ -]world[ -]tree)$/.test(name);

/** Nutrients one activation of a nursery recipe needs: every output's required_nutrients times its count. */
export function recipeNutrients(recipe: Recipe): number {
  return recipe.outputs.reduce((sum, o) => {
    const count = typeof o.count === "string" ? parseFloat(o.count) : o.count;
    return sum + count * (getItem(o.id || o.name)?.required_nutrients || 0);
  }, 0);
}

export function getEffectiveRecipeTime(
  recipe: Recipe,
  selectedFertilizer: string | undefined,
  fertilizerMultiplier = 1,
  beltLimit = Infinity,
  speedMultiplier = 1
): number {
  if (!isNurseryMachine(recipe.crafted_in?.toLowerCase() ?? "")) return recipe.time;
  const outputCount = recipe.outputs.reduce((sum, o) => sum + (typeof o.count === "string" ? parseFloat(o.count) : o.count), 0);
  // A nursery can't push more than one belt out, whatever the fertilizer (120/min at Logistics 4).
  // Callers divide by speedMultiplier afterwards, so the floor is pre-scaled to survive that.
  const minTime = (outputCount * 60 * speedMultiplier) / beltLimit;
  const nutrientsPerSec = selectedFertilizer ? getItem(selectedFertilizer)?.nutrients_per_seconds : undefined;
  if (!nutrientsPerSec) return Math.max(recipe.time, minTime);
  const nutrientsPerCycle = recipeNutrients(recipe);
  const treeIntake = TREE_NUTRIENTS_PER_SEC[recipe.crafted_in?.toLowerCase() ?? ""];
  const delivery = treeIntake ?? nutrientsPerSec * fertilizerMultiplier;
  const time = nutrientsPerCycle > 0 ? nutrientsPerCycle / delivery : recipe.time;
  // Factory speed research doesn't touch the trees (measured 3.6 nurseries for 144/min at 200% speed);
  // callers divide by speedMultiplier, so pre-scale to cancel it
  return Math.max(time, minTime) * (treeIntake ? speedMultiplier : 1);
}

/** Liquids travel by pipe, so the belt limit never applies to them. Clears the flag across a plan. */
export function isLiquid(itemRef: string): boolean {
  return !!getItem(itemRef)?.liquid;
}
export function clearLiquidBeltFlags(roots: ProductionNode[]): ProductionNode[] {
  const seen = new Set<ProductionNode>();
  const visit = (n: ProductionNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    // Liquids are piped; and "at the limit" (within float noise) is fine, only above it is not
    if (n.isBeltSaturated && (isLiquid(n.itemName) || n.rate <= (n.beltLimit ?? Infinity) * (1 + 1e-6))) n.isBeltSaturated = false;
    n.inputs.forEach(visit);
  };
  roots.forEach(visit);
  return roots;
}
