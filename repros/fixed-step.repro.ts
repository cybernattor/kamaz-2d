import { FixedStepAccumulator } from '../src/game/fixedStep';

const fixed = new FixedStepAccumulator(1 / 30, 2);
let updates = 0;

const normalSteps = fixed.consume(1 / 30, () => { updates += 1; });
if (normalSteps !== 1 || updates !== 1) throw new Error('normal frame must perform one update');

const slowSteps = fixed.consume(1, () => { updates += 1; });
if (slowSteps !== 2) throw new Error(`slow frame ran ${slowSteps} updates; expected bounded two`);
if (fixed.pendingSeconds >= 1 / 30) throw new Error('simulation debt must be bounded after a slow frame');

console.log('fixed-step: OK');
