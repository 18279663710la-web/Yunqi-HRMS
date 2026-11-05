import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_OPTIONS, DEFAULT_REGIONS, decodeFromImage } from '../../miniprogram/utils/qr-image';

test('图片读码只检查左上区域，避免整图反复扫描', async () => {
  assert.deepEqual(DEFAULT_REGIONS.map((region) => region.key), ['topLeft']);
  assert.equal(DEFAULT_OPTIONS.invert, false);
  assert.ok(DEFAULT_OPTIONS.zoomEdge <= 1000);
  const region = DEFAULT_REGIONS[0];
  assert.equal(region.x, 0);
  assert.equal(region.y, 0);
  assert.ok(region.w <= 0.6 && region.h <= 0.4);
  const noCanvas = await decodeFromImage(null, '#qrCanvas', 'invoice.jpg');
  assert.equal(noCanvas.ok, false);
});

test('真实二维码像素在图片左上角时可以读取，其他位置不会被误扫', async () => {
  const matrix = readFileSync(path.join(__dirname, 'fixtures/invoice-qr.txt'), 'utf8').trim().split(/\r?\n/);
  let qrX = 40;
  let qrY = 40;
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  const canvas: any = {
    width: 0,
    height: 0,
    createImage() {
      const img: any = { width: 1200, height: 800 };
      Object.defineProperty(img, 'src', { set: () => queueMicrotask(() => img.onload()) });
      return img;
    },
    getContext() {
      return {
        clearRect() {},
        drawImage(_img: unknown, x: number, y: number, w: number, h: number) { crop = { x, y, w, h }; },
        getImageData() {
          const pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          pixels.fill(255);
          for (let y = 0; y < canvas.height; y++) {
            for (let x = 0; x < canvas.width; x++) {
              const sourceX = crop.x + (x + 0.5) * crop.w / canvas.width;
              const sourceY = crop.y + (y + 0.5) * crop.h / canvas.height;
              const col = Math.floor((sourceX - qrX) / 6);
              const row = Math.floor((sourceY - qrY) / 6);
              if (row >= 0 && row < matrix.length && col >= 0 && col < matrix[row].length && matrix[row][col] === '1') {
                const index = (y * canvas.width + x) * 4;
                pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
              }
            }
          }
          return { data: pixels };
        },
      };
    },
  };
  const previousWx = (globalThis as any).wx;
  (globalThis as any).wx = {
    createSelectorQuery() {
      return { select() { return this; }, fields() { return this; }, exec(callback: (value: unknown) => void) { callback([{ node: canvas }]); } };
    },
  };
  try {
    const found = await decodeFromImage(null, '#qrCanvas', 'invoice.jpg');
    assert.equal(found.ok, true);
    assert.equal(found.region, 'topLeft');
    assert.equal(found.text, '01,10,044031900111,08812453,386.00,20261008,071822,ABCD');
    qrX = 950;
    qrY = 500;
    const outside = await decodeFromImage(null, '#qrCanvas', 'invoice.jpg');
    assert.equal(outside.ok, false);
  } finally {
    (globalThis as any).wx = previousWx;
  }
});
