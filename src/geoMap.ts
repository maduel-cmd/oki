import type {
  FamilyBoundaryLine,
  FamilyZone,
  LatLng,
} from '@oki/domain';

/** Local meters from center (east+, north+). */
export function offsetMeters(from: LatLng, to: LatLng): { east: number; north: number } {
  const latRad = (from.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latRad);
  return {
    east: (to.lng - from.lng) * metersPerDegLng,
    north: (to.lat - from.lat) * metersPerDegLat,
  };
}

export function chooseMapExtentM(input: {
  zones: FamilyZone[];
  lines: FamilyBoundaryLine[];
  extras?: LatLng[];
  center: LatLng;
  minM?: number;
  padFactor?: number;
}): number {
  const minM = input.minM ?? 120;
  const padFactor = input.padFactor ?? 1.35;
  let max = minM;
  for (const z of input.zones) {
    const o = offsetMeters(input.center, z.center);
    const reach = Math.hypot(o.east, o.north) + z.radiusM;
    if (reach > max) max = reach;
  }
  for (const line of input.lines) {
    for (const p of [line.a, line.b]) {
      const o = offsetMeters(input.center, p);
      const reach = Math.hypot(o.east, o.north) + line.alertWithinM;
      if (reach > max) max = reach;
    }
  }
  for (const p of input.extras ?? []) {
    const o = offsetMeters(input.center, p);
    const reach = Math.hypot(o.east, o.north);
    if (reach > max) max = reach;
  }
  return Math.max(minM, max * padFactor);
}

export function projectToSvg(
  point: LatLng,
  center: LatLng,
  extentM: number,
  size: number,
): { x: number; y: number } {
  const o = offsetMeters(center, point);
  const half = size / 2;
  return {
    x: half + (o.east / extentM) * half,
    y: half - (o.north / extentM) * half,
  };
}

export function metersToSvgRadius(radiusM: number, extentM: number, size: number): number {
  return (radiusM / extentM) * (size / 2);
}
