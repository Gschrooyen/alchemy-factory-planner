import { describe, expect, test } from "bun:test";
import { getBuildCost, getDeviceById, getDeviceRecipes, ratesPerMinute, formatRate } from "./devices.config";

const device = (id: string) => getDeviceById(id)!;

describe("devices codex", () => {
  test("plank rate matches the planner: 1 Log -> 200 Planks in 400 s is 30/min per saw", () => {
    const plank = getDeviceRecipes(device("table-saw")).find((r) => r.outputs.some((o) => o.name === "Plank"))!;
    const { outputs, inputs } = ratesPerMinute(plank);
    expect(outputs.find((o) => o.name === "Plank")!.perMinute).toBeCloseTo(30, 6);
    expect(inputs[0].perMinute).toBeCloseTo(0.15, 6);
  });

  test("enhanced grinder runs the grinder's recipes twice as fast", () => {
    const normal = getDeviceRecipes(device("grinder"));
    const enhanced = getDeviceRecipes(device("enhanced-grinder"));
    expect(enhanced.map((r) => r.id)).toEqual(normal.map((r) => r.id));
    expect(ratesPerMinute(enhanced[0]).outputs[0].perMinute).toBeCloseTo(2 * ratesPerMinute(normal[0]).outputs[0].perMinute, 6);
  });

  test("build cost resolves every material to an item and sums its value", () => {
    const { materials, coins } = getBuildCost(device("alembic"));
    expect(materials.every((m) => m.item)).toBe(true);
    expect(coins).toBe(materials.reduce((s, m) => s + (m.item!.cost ?? 0) * m.count, 0));
    expect(coins).toBeGreaterThan(0);
  });

  test("formatRate keeps small rates readable", () => {
    expect(formatRate(30)).toBe("30");
    expect(formatRate(7.5)).toBe("7.5");
    expect(formatRate(0.05)).toBe("0.05");
    expect(formatRate(1234.4)).toBe("1,234");
  });
});
