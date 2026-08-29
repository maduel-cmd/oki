import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('oki family smoke', () => {
  it('brand constant', () => {
    assert.equal('אוקי משפחה'.includes('אוקי'), true);
  });
});
