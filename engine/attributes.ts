import attributesData from "../data/attributes.json";

/**
 * Game attribute ladders, extracted from the shipped game files:
 *   DT_Attributes   -> base value and unit for each attribute
 *   DT_Improvements -> the per-level effect of each research/upgrade (deprecated rows dropped)
 *
 * Both Add and Increase modifications are additive on top of the base value; Increase simply
 * marks an attribute whose unit is a percentage (FactorySpeed 100 -> 125 at level 1 = 1.25x).
 * The top level of most ladders is repeatable, so levels past the table keep applying `repeatStep`.
 */
export interface AttributeLadder {
  base: number;
  unit: string;
  steps: number[];
  repeatStep: number | null;
  modType?: string;
}

const ladders = attributesData as Record<string, AttributeLadder>;

export type AttributeName = keyof typeof attributesData;

/** Raw attribute value at a research level, in the attribute's own unit (% or /min or a count). */
export function attributeValue(name: AttributeName, level: number): number {
  const ladder = ladders[name as string];
  if (!ladder) throw new Error(`Unknown attribute: ${name}`);

  const capped = Math.max(0, Math.floor(level));
  const within = Math.min(capped, ladder.steps.length);
  let value = ladder.base;
  for (let i = 0; i < within; i++) value += ladder.steps[i];

  const extra = capped - within;
  if (extra > 0 && ladder.repeatStep !== null) value += extra * ladder.repeatStep;
  return value;
}

/** Percentage attribute as a multiplier (FactorySpeed level 1 -> 1.25). */
export function attributeMultiplier(name: AttributeName, level: number): number {
  return attributeValue(name, level) / 100;
}

/** Highest level that still changes an attribute; levels beyond it only help if the top step repeats. */
export function maxAttributeLevel(name: AttributeName): number {
  const ladder = ladders[name as string];
  return ladder ? ladder.steps.length : 0;
}

export function getAttributeLadder(name: AttributeName): AttributeLadder | undefined {
  return ladders[name as string];
}
