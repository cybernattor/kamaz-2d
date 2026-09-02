export interface SpatialPoint {
  x: number;
  y: number;
}

/**
 * Uniform grid broad-phase for nearby entities. The narrow collision checks
 * still decide the exact result; this index only avoids testing distant pairs.
 */
export class SpatialHash<T extends SpatialPoint> {
  private readonly cells = new Map<string, T[]>();

  constructor(private readonly cellSize = 256) {}

  public clear() {
    this.cells.clear();
  }

  public insert(item: T) {
    const key = this.key(item.x, item.y);
    const bucket = this.cells.get(key);
    if (bucket) bucket.push(item);
    else this.cells.set(key, [item]);
  }

  public insertAll(items: T[]) {
    for (const item of items) this.insert(item);
  }

  public queryRadius(x: number, y: number, radius: number) {
    const minCellX = Math.floor((x - radius) / this.cellSize);
    const maxCellX = Math.floor((x + radius) / this.cellSize);
    const minCellY = Math.floor((y - radius) / this.cellSize);
    const maxCellY = Math.floor((y + radius) / this.cellSize);
    const result: T[] = [];

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucket = this.cells.get(`${cellX}:${cellY}`);
        if (bucket) result.push(...bucket);
      }
    }
    return result;
  }

  private key(x: number, y: number) {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(y / this.cellSize)}`;
  }
}
