import type { Device, Item, Recipe } from "@/engine/types";
import type { EntityConfig } from "../types";
import { getEffectiveRecipeTime } from "@/engine/item-utils";
import { ENHANCED_GRINDER_SPEED } from "@/engine/lp-planner/model-builder";
import devicesData from "@/data/devices.json";
import recipesData from "@/data/recipes.json";
import itemsData from "@/data/items.json";

const devices = devicesData as Device[];
const recipes = recipesData as unknown as Recipe[];
const itemsById = new Map((itemsData as unknown as Item[]).map((i) => [i.id, i]));
const devicesById = new Map(devices.map((d) => [d.id, d]));

/** Display order and labels for the data's device categories. */
export const DEVICE_CATEGORIES: { id: string; label: string; blurb: string }[] = [
  { id: "raw material production", label: "Raw Materials", blurb: "Grow, cut, crush and buy the basics." },
  { id: "production", label: "Crafting", blurb: "Turn materials into goods, potions and parts." },
  { id: "automated processing", label: "Processing", blurb: "Grind materials down automatically." },
];
const categoryLabel = (id: string) => DEVICE_CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** Devices without recipes of their own that run another device's recipes. */
const RECIPE_SOURCES: Record<string, { from: string; speed: number; note?: string }> = {
  "enhanced-grinder": { from: "grinder", speed: ENHANCED_GRINDER_SPEED },
  "thermal-extractor": { from: "extractor", speed: 1, note: "Output grows with every floor it's built up." },
};

export const devicesConfig: EntityConfig<Device> = {
  type: "devices",
  displayName: "Device",
  displayNamePlural: "Devices",
  description: "Every machine in Alchemy Factory: what it makes, how fast, and what it costs to build.",

  getAll: () => devices,
  getById: (id) => devicesById.get(id),
  getId: (d) => d.id,
  getName: (d) => d.name,
  getCategory: (d) => d.category,
  getSearchableText: (d) =>
    `${d.name} ${categoryLabel(d.category)} ${getDeviceRecipes(d).flatMap((r) => r.outputs.map((o) => o.name)).join(" ")}`,
  getAllCategories: () => DEVICE_CATEGORIES.map((c) => c.id),
  getDetailPath: (id) => `/devices/${id}`,
  getListPath: () => "/devices",

  generateListMetadata: () => ({
    title: "Devices",
    description:
      "All Alchemy Factory devices with the goods they produce, production rates per machine, and building costs.",
    openGraph: {
      title: "Devices | Alchemy Factory Tools",
      description: "Every Alchemy Factory machine: what it makes, how fast, and what it costs to build.",
    },
  }),

  generateDetailMetadata: (d) => {
    const makes = getDeviceRecipes(d).flatMap((r) => r.outputs.map((o) => o.name));
    const description = `${d.name} in Alchemy Factory${makes.length ? `: makes ${[...new Set(makes)].slice(0, 6).join(", ")}` : ""}. Production rates and building cost.`;
    return {
      title: d.name,
      description,
      openGraph: { title: `${d.name} | Alchemy Factory Tools`, description },
    };
  },
};

export { categoryLabel };

/** Recipes this device runs, with times already adjusted for variants such as the Enhanced Grinder. */
export function getDeviceRecipes(device: Device): Recipe[] {
  const source = RECIPE_SOURCES[device.id];
  const own = recipes.filter((r) => r.crafted_in === device.id);
  if (!source) return own;
  return recipes
    .filter((r) => r.crafted_in === source.from)
    .map((r) => ({ ...r, crafted_in: device.id, time: r.time / source.speed }));
}

export const getRecipeSource = (device: Device) => RECIPE_SOURCES[device.id];

const count = (c: number | string) => (typeof c === "string" ? parseFloat(c) : c);

/** Items per minute for one machine at base skills (no research, no fertilizer). */
export function ratesPerMinute(recipe: Recipe) {
  const minutes = getEffectiveRecipeTime(recipe, undefined) / 60;
  const rate = (c: number | string) => count(c) / minutes;
  return {
    outputs: recipe.outputs.map((o) => ({ name: o.name, perMinute: rate(o.count), percentage: o.percentage })),
    inputs: recipe.inputs.map((i) => ({ name: i.name, perMinute: rate(i.count) })),
  };
}

/** Build materials with their item, plus the total coin value of buying them. */
export function getBuildCost(device: Device) {
  const materials = (device.build_cost ?? []).map((c) => ({ ...c, item: itemsById.get(c.id) }));
  const coins = materials.reduce((sum, m) => sum + (m.item?.cost ?? 0) * m.count, 0);
  return { materials, coins };
}

export function getDeviceById(id: string) {
  return devicesById.get(id);
}

/** Short heat line: what a heated device draws and where it sits, or how many slots a furnace offers. */
export function heatLine(d: Device): string | undefined {
  if (d.slots) return `Holds ${d.slots} slots of heated devices`;
  if (!d.heat_consuming_speed) return undefined;
  const parent = d.parent ? devicesById.get(d.parent)?.name : undefined;
  const slots = d.slots_required === 1 ? "1 slot" : `${d.slots_required} slots`;
  return `Uses ${d.heat_consuming_speed} P/s heat${parent ? ` · ${slots} on a ${parent}` : ""}`;
}

/** Card data for the list page (plain values, safe to send to the client). */
export function toDeviceSummary(d: Device) {
  const { materials, coins } = getBuildCost(d);
  return {
    id: d.id,
    name: d.name,
    category: d.category,
    makes: [...new Set(getDeviceRecipes(d).flatMap((r) => r.outputs.map((o) => o.name)))],
    materials: materials.map((m) => ({ name: m.item?.name ?? m.id, count: m.count })),
    coins,
    heat: heatLine(d),
  };
}

/** 30 -> "30", 7.5 -> "7.5", 0.05 -> "0.05" */
export function formatRate(n: number) {
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3;
  return Number(n.toFixed(digits)).toLocaleString("en-US");
}
