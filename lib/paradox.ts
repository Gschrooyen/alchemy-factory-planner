import { getAllItems } from "@/engine/item-utils";
import type { Item, Recipe } from "@/engine/types";

/**
 * Paradox Crucible, reverse-engineered from UParadoxFacilityComponent
 * (EstimatedTotalSeconds @ RVA 0x4A19260, GetProductName @ 0x4A1D390, load/commit closures).
 *
 * When idle it pulls the whole input slot into the pot as one batch. The batch value is
 * stack x cauldronCost, and it brews ONE unit of product in clamp(1500 / value, 0.5, 1500) seconds,
 * consuming the whole batch. Mors and Vitae are special: a flat 5 seconds. Everything turns into
 * Mors, except Mors itself, which turns into Vitae. Belt input only, so no liquids.
 */

export const PARADOX_HEAT = 1200; // heat/s while active (DT_Buildings.ParadoxCrucible.HeatCost)
const MORS = "mors";
const VITAE = "vitae";
const FIXED_TIME = 5;
const VALUE_CONSTANT = 1500;
const MIN_TIME = 0.5;
const MAX_TIME = 1500;

export interface ParadoxInput {
  id: string;
  name: string;
  cc: number; // cauldron cost per unit
}

export function paradoxProductId(inputId: string): string {
  return inputId === MORS ? VITAE : MORS;
}

/** Seconds for one batch of `stack` units of an item with cauldron cost `cc` (before research speed). */
export function paradoxBatchTime(inputId: string, cc: number, stack: number): number {
  if (inputId === MORS || inputId === VITAE) return FIXED_TIME;
  const value = Math.max(1, stack) * cc;
  return Math.min(MAX_TIME, Math.max(MIN_TIME, VALUE_CONSTANT / value));
}

export function getParadoxInputs(): ParadoxInput[] {
  return getAllItems()
    .filter((i: Item) => (i.cauldron_cost ?? 0) > 0 && !i.liquid && !i.hidden)
    .map((i) => ({ id: i.id, name: i.name, cc: i.cauldron_cost! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Synthetic LP recipe: feed `inputId` one at a time (best yield) to make `outputId`, or null if it does not. */
export function paradoxRecipeFor(outputId: string, inputId: string): Recipe | null {
  const input = getParadoxInputs().find((i) => i.id === inputId);
  if (!input || paradoxProductId(inputId) !== outputId) return null;
  const output = getAllItems().find((i) => i.id === outputId);
  if (!output) return null;
  return {
    id: "paradox:" + outputId,
    inputs: [{ id: input.id, name: input.name, count: 1 }],
    outputs: [{ id: outputId, name: output.name, count: 1 }],
    time: paradoxBatchTime(inputId, input.cc, 1),
    crafted_in: "paradox-crucible",
    heat_per_second: PARADOX_HEAT,
  };
}
