import { formatRubles, repairCost } from '../src/game/repair';

function main() {
  if (repairCost(100, 100) !== 0) throw new Error('An intact car must cost nothing to repair');
  if (repairCost(99.8, 100) !== 0) throw new Error('Sub-point scratches must not be billable');
  const light = repairCost(90, 100);
  const heavy = repairCost(20, 100);
  if (!(light > 0 && heavy > light)) throw new Error(`Heavier damage must cost more (${light} vs ${heavy})`);
  if (repairCost(-5, 100) !== repairCost(0, 100)) throw new Error('Negative health must be clamped');
  if (!formatRubles(1200).includes('₽')) throw new Error('Price must be formatted in rubles');
  console.log(`FIXED: repair priced by damage (10 pts = ${light} ₽, 80 pts = ${heavy} ₽).`);
}

main();
