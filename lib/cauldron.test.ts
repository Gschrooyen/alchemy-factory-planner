import { describe, test, expect } from "bun:test";
import { cauldronProduct, cauldronTiming, enumerateCauldronRecipes, getCauldronInputs, getCauldronOutputs } from "./cauldron";

const inputs = getCauldronInputs();
const outputs = getCauldronOutputs(inputs);
const byId = (id: string) => {
  const i = inputs.find((x) => x.id === id);
  if (!i) throw new Error("no cauldron item " + id);
  return i;
};

describe("Cauldron", () => {
  // The four cauldron rows in the game's DT_EnemyCrafting, with their crafting times
  test.each([
    [["ruby", "sapphire", "emerald"], "philosopherstone", 60],
    [["diamond2", "golddust5", "catalyst3"], "ruby", 30.9],
    [["diamond3", "worldtreecore", "catalyst1"], "sapphire", 38.2],
    [["moonlitsoap", "lapislazuli", "catalyst2"], "emerald", 45.5],
  ])("%p -> %s in %ss", (ings, product, time) => {
    const r = cauldronProduct(ings.map(byId), outputs);
    expect(r?.output.id).toBe(product);
    expect(cauldronTiming(r!.output.ct).time).toBe(time);
  });

  // In-game observations (basic pot): 3 x Basic Fertilizer -> Iron Sand, 2 x Basic Fertilizer + Brick -> Coke
  test("repeated ingredients scale the sum: x0.5 for a triple, x0.65 for a pair", () => {
    const fert = byId("basicfertilizer");
    expect(cauldronProduct([fert, fert, fert], outputs)?.output.id).toBe("ironsand"); // 30 * 0.5 = 15
    expect(cauldronProduct([fert, fert, byId("brick")], outputs)?.output.id).toBe("coke"); // 45 * 0.65 = 29.25
  });

  test("timing bands and clamps", () => {
    expect(cauldronTiming(1)).toEqual({ time: 3, heat: 1 });
    expect(cauldronTiming(100)).toEqual({ time: 6, heat: 20 });
    expect(cauldronTiming(1000)).toEqual({ time: 12, heat: 200 });
    expect(cauldronTiming(10000)).toEqual({ time: 24, heat: 1500 });
    expect(cauldronTiming(5e6).time).toBe(60); // capped
    expect(cauldronTiming(5e6).heat).toBe(10000); // capped
  });

  test("two identical inputs step up to the next target, never themselves", () => {
    const r = cauldronProduct([byId("ruby"), byId("ruby")], outputs);
    expect(r).not.toBeNull();
    expect(r!.output.id).not.toBe("ruby");
    expect(r!.output.ct).toBeGreaterThan(byId("ruby").cc);
  });

  test("two different inputs never yield the pricier input", () => {
    const r = cauldronProduct([byId("ruby"), byId("catalyst1")], outputs);
    expect(r?.output.id).not.toBe("ruby");
  });

  test("liquids are never ingredients (no pipe port on either pot)", () => {
    expect(inputs.find((i) => i.id === "aquavitae")).toBeUndefined();
    expect(inputs.find((i) => i.id === "brandy")).toBeUndefined();
    expect(inputs.length).toBe(144); // 170 with a cauldron cost, minus 12 liquids, minus 14 hidden items
  });

  test("items hidden in game are not ingredients", () => {
    for (const id of ["finebandage", "amethyst", "sand2", "golddust4"]) {
      expect(inputs.find((i) => i.id === id)).toBeUndefined();
    }
  });

  test("enumeration yields something and only cauldronMulti>0 outputs", () => {
    let n = 0;
    for (const r of enumerateCauldronRecipes(inputs.slice(0, 12), outputs)) {
      expect(r.output.cm).toBeGreaterThan(0);
      if (++n > 500) break;
    }
    expect(n).toBeGreaterThan(50);
  });
});
