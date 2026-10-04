import { describe, expect, test } from "bun:test";
import { toCoins } from "./coins";

describe("toCoins", () => {
  test("splits copper into gold / silver / copper (1 gold = 100 silver, 1 silver = 1000 copper)", () => {
    expect(toCoins(103_014)).toEqual({ gold: 1, silver: 3, copper: 14 });
    expect(toCoins(153_000)).toEqual({ gold: 1, silver: 53, copper: 0 }); // Gold Coin: gameValue 153 silver
    expect(toCoins(44_500_000)).toEqual({ gold: 445, silver: 0, copper: 0 }); // Sol: gameValue 445 gold
    expect(toCoins(1_903.4)).toEqual({ gold: 0, silver: 1, copper: 903 }); // rounds to whole copper
  });
});
