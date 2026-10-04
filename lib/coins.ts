/**
 * The game stores every price in copper and shows it as gold/silver/copper:
 * 1 gold = 100 silver, 1 silver = 1000 copper (checked against gameValue for all 180 items in AlchemyFactoryData).
 */
const SILVER = 1000;
const GOLD = 100 * SILVER;

export function toCoins(copper: number): { gold: number; silver: number; copper: number } {
  const total = Math.round(copper);
  return { gold: Math.floor(total / GOLD), silver: Math.floor((total % GOLD) / SILVER), copper: total % SILVER };
}

