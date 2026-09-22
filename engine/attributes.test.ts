import { describe, test, expect } from "bun:test";
import { attributeValue, attributeMultiplier, maxAttributeLevel } from "./attributes";

// Values below are the game's own DT_Attributes base values and DT_Improvements steps.
describe("Attribute ladders", () => {
  test("level 0 is the base value", () => {
    expect(attributeValue("FactorySpeed", 0)).toBe(100);
    expect(attributeValue("ConveyerSpeed", 0)).toBe(60);
    expect(attributeValue("AltarEfficiency", 0)).toBe(0);
  });

  test("FactorySpeed: +25%/level for 12, then a repeatable +5%", () => {
    expect(attributeMultiplier("FactorySpeed", 1)).toBeCloseTo(1.25);
    expect(attributeMultiplier("FactorySpeed", 12)).toBeCloseTo(4);
    expect(attributeMultiplier("FactorySpeed", 13)).toBeCloseTo(4.05);
    expect(attributeMultiplier("FactorySpeed", 20)).toBeCloseTo(4.4);
  });

  test("ExtractorSkill: 6/6/8x6/10.. tiers", () => {
    expect(attributeMultiplier("ExtractorSkill", 2)).toBeCloseTo(1.12);
    expect(attributeMultiplier("ExtractorSkill", 8)).toBeCloseTo(1.6);
    expect(attributeMultiplier("ExtractorSkill", 12)).toBeCloseTo(2.0);
  });

  test("ConveyerSpeed: 60 base, +15/level for 12, then +3", () => {
    expect(attributeValue("ConveyerSpeed", 12)).toBe(240);
    expect(attributeValue("ConveyerSpeed", 14)).toBe(246);
  });

  test("finite ladders stop: StoreProfit has 4 levels, ContractNum 5", () => {
    expect(maxAttributeLevel("StoreProfit")).toBe(4);
    expect(attributeValue("StoreProfit", 4)).toBe(140);
    expect(attributeValue("StoreProfit", 99)).toBe(140); // no repeatable step
    expect(maxAttributeLevel("ContractNum")).toBe(5);
    expect(attributeValue("ContractNum", 99)).toBe(300);
  });

  test("negative and fractional levels are clamped/floored", () => {
    expect(attributeValue("FactorySpeed", -3)).toBe(100);
    expect(attributeValue("FactorySpeed", 1.9)).toBe(125);
  });
});
