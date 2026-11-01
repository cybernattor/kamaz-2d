import { Graphics } from 'pixi.js';
import { DestructibleObject, TrafficLight, VehicleInstance } from '../types';
import { VEHICLE_CONFIGS } from './vehicleConfigs';
import { colorNumber } from './pixiUtils';

/** Pure Graphics drawing for sprite templates; no renderer state involved. */

export function drawProp(graphics: Graphics, prop: DestructibleObject) {
  graphics.clear();
  if (prop.type === 'crate') {
    graphics.rect(-prop.width / 2, -prop.height / 2, prop.width, prop.height).fill(0xb45309).stroke({ color: 0x78350f, width: 2 });
    graphics.moveTo(-prop.width / 2, -prop.height / 2).lineTo(prop.width / 2, prop.height / 2).stroke({ color: 0x78350f, width: 2 });
    graphics.moveTo(prop.width / 2, -prop.height / 2).lineTo(-prop.width / 2, prop.height / 2).stroke({ color: 0x78350f, width: 2 });
  } else if (prop.type === 'fence') {
    graphics.rect(-prop.width / 2, -3, prop.width, 6).fill(0xe2e8f0);
    graphics.rect(-prop.width / 2, -5, 6, 10).fill(0x475569);
    graphics.rect(prop.width / 2 - 6, -5, 6, 10).fill(0x475569);
  } else if (prop.type === 'lamp_pole') {
    graphics.circle(0, 0, 6).fill(0x475569);
    graphics.circle(0, 0, 3).fill(0xfef08a);
  } else {
    const color = prop.type === 'cone' ? 0xea580c : prop.type === 'hydrant' ? 0xdc2626 : prop.type === 'barrel' ? 0x0284c7 : 0x1e293b;
    graphics.circle(0, 0, prop.type === 'trash_can' ? 6 : 7).fill(color);
  }
}

export function drawTrafficLight(graphics: Graphics, light: TrafficLight) {
  graphics.clear();
  graphics.rect(-5, -14, 10, 28).fill(0x0f172a).stroke({ color: 0x334155, width: 1.5 });
  graphics.circle(0, -9, 3.5).fill(light.state === 'red' ? 0xef4444 : 0x450a0a);
  graphics.circle(0, 0, 3.5).fill(light.state === 'yellow' ? 0xeab308 : 0x422006);
  graphics.circle(0, 9, 3.5).fill(light.state === 'green' ? 0x22c55e : 0x052e16);
  graphics.rect(6, -4, 5, 8).fill(light.pedestrianState === 'walk' ? 0x22c55e : 0xef4444);
}

export function drawVehicle(graphics: Graphics, vehicle: VehicleInstance) {
  const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
  const halfLength = config.length / 2;
  const halfWidth = config.width / 2;
  const body = colorNumber(vehicle.color, 0x64748b);
  graphics.clear();

  const wheelColor = 0x111827;
  graphics.rect(-halfLength * 0.58, -halfWidth - 3, 12, 6).fill(wheelColor);
  graphics.rect(-halfLength * 0.58, halfWidth - 3, 12, 6).fill(wheelColor);

  // Each class gets one strong top-down cue that survives the normal game
  // zoom. The scene is too dense for fussy detail: silhouette and livery
  // must identify a vehicle before its colour does.
  if (vehicle.type === 'ambulance') {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(0xffffff).stroke({ color: 0xe2e8f0, width: 1.5 });
    graphics.rect(-halfLength, -halfWidth + 4, config.length, 3).fill(0xdc2626);
    graphics.rect(-halfLength, halfWidth - 7, config.length, 3).fill(0xdc2626);
    graphics.rect(-6, -2, 12, 4).fill(0xdc2626);
    graphics.rect(-2, -6, 4, 12).fill(0xdc2626);
    graphics.rect(halfLength * 0.45, -halfWidth + 3, 5, config.width - 6).fill(0x0284c7);
  } else if (vehicle.type === 'police') {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(0x0f172a);
    graphics.rect(-halfLength * 0.2, -halfWidth + 2, halfLength * 0.8, config.width - 4).fill(0xffffff);
    graphics.rect(halfLength * 0.35, -halfWidth + 3, 5, config.width - 6).fill(0x0284c7);
    graphics.rect(-halfLength * 0.55, -halfWidth + 3, 4, config.width - 6).fill(0x0284c7);
  } else if (vehicle.type === 'kamaz_dump') {
    // Raised ribbed tipper body and a separate cab make the KAMAZ readable
    // as working machinery rather than a long orange sedan.
    graphics.rect(-halfLength, -halfWidth + 3, halfLength * 1.15, config.width - 6).fill(0xd97706).stroke({ color: 0x78350f, width: 2 });
    graphics.rect(-halfLength * 0.85, -halfWidth + 6, halfLength * 0.78, config.width - 12).fill(0x92400e);
    for (let rib = 0; rib < 3; rib += 1) {
      graphics.rect(-halfLength * 0.7 + rib * halfLength * 0.24, -halfWidth + 5, 3, config.width - 10).fill(0xfbbf24);
    }
    graphics.rect(halfLength * 0.2, -halfWidth, halfLength * 0.8, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.rect(halfLength * 0.5, -halfWidth + 4, halfLength * 0.22, config.width - 8).fill(0x7dd3fc);
  } else if (vehicle.type === 'kamaz_flatbed') {
    // Open rails and boxed cargo distinguish the flatbed from a dump body.
    graphics.rect(-halfLength, -halfWidth + 4, halfLength * 1.16, config.width - 8).fill(0x075985).stroke({ color: 0x0c4a6e, width: 2 });
    graphics.rect(-halfLength * 0.92, -halfWidth + 6, halfLength * 0.85, 3).fill(0xe2e8f0);
    graphics.rect(-halfLength * 0.92, halfWidth - 9, halfLength * 0.85, 3).fill(0xe2e8f0);
    graphics.rect(-halfLength * 0.7, -halfWidth + 9, 15, config.width - 18).fill(0x94a3b8);
    graphics.rect(-halfLength * 0.3, -halfWidth + 9, 15, config.width - 18).fill(0xf59e0b);
    graphics.rect(halfLength * 0.2, -halfWidth, halfLength * 0.8, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.rect(halfLength * 0.5, -halfWidth + 4, halfLength * 0.22, config.width - 8).fill(0x7dd3fc);
  } else if (vehicle.type === 'bus') {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.rect(-halfLength * 0.78, -halfWidth + 4, halfLength * 1.45, 4).fill(0xbfe9ff);
    graphics.rect(-halfLength * 0.78, halfWidth - 8, halfLength * 1.45, 4).fill(0xbfe9ff);
    graphics.rect(-5, -halfWidth + 3, 7, config.width - 6).fill(0xf8fafc);
    graphics.rect(-halfLength * 0.45, -5, 11, 10).fill(0x0f172a);
  } else if (vehicle.type === 'taxi') {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
    for (let mark = 0; mark < 4; mark += 1) {
      graphics.rect(-halfLength * 0.48 + mark * 6, -halfWidth + 2, 4, 4).fill(mark % 2 === 0 ? 0x111827 : 0xf8fafc);
      graphics.rect(-halfLength * 0.48 + mark * 6, halfWidth - 6, 4, 4).fill(mark % 2 === 0 ? 0x111827 : 0xf8fafc);
    }
    graphics.rect(-2, -5, 9, 10).fill(0xf8fafc).stroke({ color: 0x111827, width: 1.5 });
    graphics.rect(halfLength * 0.22, -halfWidth + 3, halfLength * 0.3, config.width - 6).fill(0x7dd3fc);
  } else if (vehicle.type === 'sports') {
    graphics.poly([-halfLength, -halfWidth * 0.58, -halfLength * 0.62, -halfWidth, halfLength * 0.76, -halfWidth, halfLength, 0, halfLength * 0.76, halfWidth, -halfLength * 0.62, halfWidth, -halfLength, halfWidth * 0.58]).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.poly([-halfLength * 0.22, -halfWidth + 3, halfLength * 0.48, -halfWidth + 3, halfLength * 0.62, 0, halfLength * 0.48, halfWidth - 3, -halfLength * 0.22, halfWidth - 3]).fill(0x7dd3fc);
    graphics.rect(-halfLength * 0.9, -halfWidth - 3, 8, 2).fill(0x111827);
    graphics.rect(-halfLength * 0.9, halfWidth + 1, 8, 2).fill(0x111827);
  } else if (vehicle.type === 'hatchback') {
    graphics.poly([-halfLength * 0.8, -halfWidth, halfLength, -halfWidth, halfLength, halfWidth, -halfLength * 0.8, halfWidth, -halfLength, halfWidth * 0.48, -halfLength, -halfWidth * 0.48]).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.rect(-halfLength * 0.16, -halfWidth + 3, halfLength * 0.45, config.width - 6).fill(0x7dd3fc);
    graphics.rect(-halfLength * 0.82, -halfWidth + 4, 5, config.width - 8).fill(0x475569);
  } else if (vehicle.type === 'heavy_4x4') {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2 });
    graphics.rect(-halfLength * 0.82, -halfWidth - 2, 16, 4).fill(0x111827);
    graphics.rect(-halfLength * 0.82, halfWidth - 2, 16, 4).fill(0x111827);
    graphics.rect(-halfLength * 0.72, -halfWidth + 5, halfLength * 0.54, config.width - 10).fill(0x334155);
    graphics.rect(halfLength * 0.08, -halfWidth + 3, halfLength * 0.42, config.width - 6).fill(0x7dd3fc);
  } else {
    graphics.rect(-halfLength, -halfWidth, config.length, config.width).fill(body).stroke({ color: 0x0f172a, width: 2, alpha: 0.75 });
    graphics.rect(-halfLength * 0.1, -halfWidth + 3, halfLength * 0.42, config.width - 6).fill(0x7dd3fc);
    graphics.rect(-halfLength * 0.62, -halfWidth + 5, halfLength * 0.28, config.width - 10).fill(0x94a3b8);
  }
  // The flashing lightbar is dynamic (it alternates color on a timer) so it
  // belongs on the indicator overlay in drawVehicleIndicators, not on this
  // cached-per-type-and-color body texture.
  graphics.rect(halfLength - 4, -halfWidth + 2, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
  graphics.rect(halfLength - 4, halfWidth - 7, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
  graphics.rect(-halfLength - 1, -halfWidth + 2, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
  graphics.rect(-halfLength - 1, halfWidth - 7, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);

  if (vehicle.isCrashed) graphics.rect(-halfLength - 4, -halfWidth - 4, config.length + 8, config.width + 8).stroke({ color: 0xf97316, width: 3 });
}

export function drawVehicleIndicators(graphics: Graphics, vehicle: VehicleInstance) {
  const config = VEHICLE_CONFIGS[vehicle.type] || VEHICLE_CONFIGS.sedan;
  const halfLength = config.length / 2;
  const halfWidth = config.width / 2;
  graphics.clear();
  graphics.rect(halfLength - 4, -halfWidth + 2, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
  graphics.rect(halfLength - 4, halfWidth - 7, 4, 5).fill(vehicle.headlights > 0 ? 0xfef08a : 0x94a3b8);
  graphics.rect(-halfLength - 1, -halfWidth + 2, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
  graphics.rect(-halfLength - 1, halfWidth - 7, 3, 5).fill(vehicle.isBraking ? 0xef4444 : 0x7f1d1d);
  if (vehicle.turnSignal !== 'none' && Math.floor(Date.now() / 350) % 2 === 0) {
    const left = vehicle.turnSignal === 'left' || vehicle.turnSignal === 'hazard';
    const right = vehicle.turnSignal === 'right' || vehicle.turnSignal === 'hazard';
    const signalPoints = [
      ...(left ? [[halfLength - 2, -halfWidth + 2], [-halfLength + 2, -halfWidth + 2]] : []),
      ...(right ? [[halfLength - 2, halfWidth - 2], [-halfLength + 2, halfWidth - 2]] : []),
    ];
    for (const [x, y] of signalPoints) {
      graphics.circle(x, y, 6).fill({ color: 0xf59e0b, alpha: 0.2 });
      graphics.circle(x, y, 4).fill(0xf59e0b);
    }
  }
  // Emergency lightbar. Ambulance/police used to render as a plain sedan
  // with no siren livery at all — this is what actually identifies them
  // as emergency vehicles at a glance, flashing on the same 150ms cadence
  // as the Canvas renderer.
  const flash = Math.floor(Date.now() / 150) % 2 === 0;
  if (vehicle.type === 'ambulance') {
    graphics.rect(halfLength * 0.1, -8, 8, 16).fill(flash ? 0xef4444 : 0x3b82f6);
  } else if (vehicle.type === 'police') {
    graphics.rect(-2, -7, 6, 7).fill(flash ? 0xef4444 : 0x3b82f6);
    graphics.rect(-2, 0, 6, 7).fill(flash ? 0x3b82f6 : 0xef4444);
  }
  if (vehicle.isCrashed) {
    graphics.rect(-halfLength - 4, -halfWidth - 4, config.length + 8, config.width + 8).stroke({ color: 0xf97316, width: 3 });
    // "!" warning marker above the vehicle, approximated without a Text
    // object (this graphic is cached/regenerated as a texture, so a glyph
    // would need to be baked in some other way): a triangle plus a stem
    // and dot standing in for the exclamation mark.
    graphics.poly([0, -halfWidth - 19, 10, -halfWidth - 4, -10, -halfWidth - 4]).fill(0xfacc15);
    graphics.rect(-1.5, -halfWidth - 17, 3, 8).fill(0x111827);
    graphics.circle(0, -halfWidth - 6, 1.6).fill(0x111827);
  }
}

export function drawHeadlight(graphics: Graphics, x: number, y: number, angle: number, mode: number) {
  const distance = mode === 2 ? 270 : 190;
  const spread = mode === 2 ? 0.38 : 0.28;
  const left = angle - spread;
  const right = angle + spread;
  graphics
    .poly([
      x,
      y,
      x + Math.cos(left) * distance,
      y + Math.sin(left) * distance,
      x + Math.cos(right) * distance,
      y + Math.sin(right) * distance,
    ])
    .fill({ color: 0xfef08a, alpha: 0.08 });
}
