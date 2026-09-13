import assert from 'node:assert/strict';
import test from 'node:test';
import { COLS, ROWS } from '../shared/contracts';
import { cameraPreset, TOWER, WINDOW_COUNT, windowPosition } from '../web/three/layout';
import * as THREE from 'three';
import { createBuildingModel, disposeScene } from '../web/three/model';
import type { Frame } from '../shared/contracts';

test('physical facade has exactly 153 unique windows in display row order', () => {
  const positions = Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLS }, (_, col) => windowPosition(row, col)));
  assert.equal(WINDOW_COUNT, 153);
  assert.equal(new Set(positions.flat().map(point => point.join(','))).size, 153);
  assert.equal(positions[0][0][0], -positions[0][COLS - 1][0]);
  assert.ok(positions[0][0][1] > positions[ROWS - 1][0][1], 'frame row zero must map to the highest display floor');
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    assert.equal(positions[row][col][2], TOWER.windowZ);
    if (col) assert.ok(positions[row][col][0] > positions[row][col - 1][0]);
  }
  assert.throws(() => windowPosition(17, 0), RangeError);
  assert.throws(() => windowPosition(0, 9), RangeError);
  assert.throws(() => windowPosition(-1, 0), RangeError);
});

test('camera presets stay in front of the display and fit portrait screens', () => {
  const full = cameraPreset('full', 1.5), windows = cameraPreset('windows', 1.5), river = cameraPreset('river', 1.5);
  assert.ok(full.position[0] > 0, 'default view reveals the right-hand facade');
  assert.ok(windows.position[2] < full.position[2], 'facade preset moves closer');
  assert.ok(river.position[2] > full.position[2], 'river preset includes more campus');
  assert.ok(cameraPreset('full', 0.5).position[2] > full.position[2]);
  for (const preset of [full, windows, river]) assert.ok(preset.position[2] > TOWER.windowZ);
});

test('RGB frame corners map to the real window instances without transpose or inversion', () => {
  const scene = new THREE.Scene();
  try {
    const model = createBuildingModel(scene);
    const windows = scene.getObjectByName('153 individually addressable south facade windows') as THREE.InstancedMesh;
    assert.equal(windows.count, 153);
    const frame: Frame = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [0, 0, 0]));
    frame[0][0] = [255, 0, 0];
    frame[16][8] = [0, 128, 255];
    model.updateFrame(frame);
    const actual = new THREE.Color();
    windows.getColorAt(0, actual);
    assert.deepEqual(actual.toArray(), [1, 0, 0]);
    windows.getColorAt(152, actual);
    const expected = new THREE.Color().setRGB(0, 128 / 255, 1, THREE.SRGBColorSpace);
    assert.ok(Math.abs(actual.g - expected.g) < 1e-6);
    assert.equal(actual.b, 1);
    windows.getColorAt(8, actual);
    assert.deepEqual(actual.toArray(), [0, 0, 0], 'top-right stays dark when only the opposite corners are lit');
    const topLeft = new THREE.Matrix4(), bottomRight = new THREE.Matrix4();
    windows.getMatrixAt(0, topLeft); windows.getMatrixAt(152, bottomRight);
    assert.ok(topLeft.elements[12] < bottomRight.elements[12]);
    assert.ok(topLeft.elements[13] > bottomRight.elements[13]);
  } finally { disposeScene(scene); }
});
