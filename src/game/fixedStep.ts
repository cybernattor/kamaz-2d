/**
 * Bounds simulation work after a slow frame. Keeping at most two pending
 * steps avoids the catch-up spiral that otherwise turns a brief hitch into a
 * persistent frame-rate collapse.
 */
export class FixedStepAccumulator {
  private accumulator = 0;

  constructor(
    public readonly stepSeconds = 1 / 30,
    public readonly maxStepsPerFrame = 2
  ) {}

  public consume(deltaSeconds: number, update: (stepSeconds: number) => void) {
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, deltaSeconds),
      this.stepSeconds * this.maxStepsPerFrame
    );
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      update(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps += 1;
    }
    return steps;
  }

  public get pendingSeconds() {
    return this.accumulator;
  }
}
