import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseMapExtentM,
  metersToSvgRadius,
  offsetMeters,
  projectToSvg,
} from './geoMap';

describe('family geoMap', () => {
  it('offsetMeters is ~0 for same point', () => {
    const o = offsetMeters({ lat: 32, lng: 34.8 }, { lat: 32, lng: 34.8 });
    assert.ok(Math.abs(o.east) < 1e-6);
    assert.ok(Math.abs(o.north) < 1e-6);
  });

  it('projectToSvg puts center in the middle', () => {
    const c = { lat: 32.08, lng: 34.78 };
    const p = projectToSvg(c, c, 200, 280);
    assert.equal(p.x, 140);
    assert.equal(p.y, 140);
  });

  it('chooseMapExtentM grows with zone radius', () => {
    const c = { lat: 32, lng: 35 };
    const extent = chooseMapExtentM({
      center: c,
      zones: [
        {
          id: 'z1',
          name: 'בית',
          center: c,
          radiusM: 400,
          forceAudio: true,
        },
      ],
      lines: [],
      minM: 120,
    });
    assert.ok(extent >= 400);
  });

  it('metersToSvgRadius scales linearly', () => {
    assert.equal(metersToSvgRadius(100, 200, 280), 70);
  });
});
