import { describe, test, expect } from "bun:test";
import { paradoxBatchTime, paradoxProductId, getParadoxInputs, paradoxRecipeFor } from "./paradox";

describe("Paradox Crucible", () => {
  test("Mors and Vitae are the fixed 5s pair", () => {
    expect(paradoxProductId("mors")).toBe("vitae");
    expect(paradoxProductId("vitae")).toBe("mors");
    expect(paradoxProductId("coal")).toBe("mors");
    expect(paradoxBatchTime("mors", 600, 1)).toBe(5);
    expect(paradoxBatchTime("vitae", 900, 50)).toBe(5); // stack size is irrelevant for the pair
  });

  test("time is 1500 / (stack * cost), clamped to [0.5, 1500]", () => {
    expect(paradoxBatchTime("coal", 40, 1)).toBeCloseTo(37.5);
    expect(paradoxBatchTime("coal", 40, 10)).toBeCloseTo(3.75); // ten coal -> still one Mors
    expect(paradoxBatchTime("wood", 0.8, 1)).toBe(1500); // cap
    expect(paradoxBatchTime("diamond2", 65536, 1)).toBe(0.5); // floor
  });

  test("inputs are every belt-able, obtainable item with a cauldron cost", () => {
    const inputs = getParadoxInputs();
    expect(inputs.length).toBe(144);
    expect(inputs.find((i) => i.id === "brandy")).toBeUndefined();
    expect(inputs.find((i) => i.id === "finebandage")).toBeUndefined();
  });

  test("paradoxRecipeFor builds a one-unit LP recipe, or null for a wrong pairing", () => {
    const r = paradoxRecipeFor("mors", "coal")!;
    expect(r.crafted_in).toBe("paradox-crucible");
    expect(r.inputs).toEqual([{ id: "coal", name: "Coal", count: 1 }]);
    expect(r.time).toBeCloseTo(37.5);
    expect(paradoxRecipeFor("vitae", "coal")).toBeNull();
    expect(paradoxRecipeFor("vitae", "mors")?.time).toBe(5);
  });
});
