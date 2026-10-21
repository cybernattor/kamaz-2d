/** Service-station pricing: you pay for the damage, not a flat fee. */
export const REPAIR_RATE_PER_HEALTH = 40;

export function repairCost(health: number, maxHealth: number): number {
  const damage = Math.max(0, maxHealth - Math.max(0, health));
  if (damage < 0.5) return 0;
  return Math.ceil((damage * REPAIR_RATE_PER_HEALTH) / 10) * 10;
}

export function formatRubles(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}
