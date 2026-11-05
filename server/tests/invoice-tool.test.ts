import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('发票工具台不加载样本或模拟查验，保留二维码解析和内部查重', async () => {
  let definition: any;
  const requests: string[] = [];
  const messages: string[] = [];
  const sources: string[][] = [];
  const choices: any[] = [];
  let holdDuplicate = false;
  let pendingDuplicate: any;
  const matrix = readFileSync(path.join(__dirname, 'fixtures/invoice-qr.txt'), 'utf8').trim().split(/\r?\n/);
  let qrVisible = true;
  let onImageComplete: (() => void) | undefined;
  const imageComplete = new Promise<void>((resolve) => { onImageComplete = resolve; });
  const canvas: any = {
    width: 0, height: 0,
    createImage() {
      const img: any = { width: 600, height: 400 };
      Object.defineProperty(img, 'src', { set: () => queueMicrotask(() => img.onload()) });
      return img;
    },
    getContext() {
      return {
        clearRect() {}, drawImage() {},
        getImageData() {
          const data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          data.fill(255);
          if (!qrVisible) return { data };
          for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
            const col = Math.floor((x - 10) / 3);
            const row = Math.floor((y - 10) / 3);
            if (row >= 0 && row < matrix.length && col >= 0 && col < matrix[row].length && matrix[row][col] === '1') {
              const pos = (y * canvas.width + x) * 4;
              data[pos] = data[pos + 1] = data[pos + 2] = 0;
            }
          }
          return { data };
        },
      };
    },
  };
  const previousPage = (globalThis as any).Page;
  const previousWx = (globalThis as any).wx;
  (globalThis as any).Page = (page: unknown) => { definition = page; };
  (globalThis as any).wx = {
    getStorageSync: () => 'test-token',
    showToast: ({ title }: { title: string }) => { messages.push(title); if (title === '已从图片中读出二维码' || title.startsWith('未识别到左上角')) onImageComplete?.(); },
    chooseMedia: (options: { sourceType: string[] }) => { sources.push(options.sourceType); choices.push(options); },
    createSelectorQuery: () => ({ select() { return this; }, fields() { return this; }, exec(callback: (v: unknown) => void) { callback([{ node: canvas }]); } }),
    request: (options: any) => {
      requests.push(options.url);
      if (holdDuplicate && options.url.endsWith('/invoices/duplicate')) {
        pendingDuplicate = options;
        return;
      }
      const data = options.url.endsWith('/invoices/meta')
        ? { verifyDriver: 'mock', mockRules: ['mock'] }
        : options.url.endsWith('/invoices/duplicate')
          ? { duplicated: false, blocking: false, hits: [] }
          : { status: 'valid', statusText: '查验通过', level: 'ok', message: '发票信息核验通过', mock: false };
      options.success({ statusCode: 200, data: { code: 0, data } });
    },
  };
  try {
    await import('../../miniprogram/pages/invoice-tool/invoice-tool');
    const page = { ...definition, data: { ...definition.data }, setData(update: object) { Object.assign(this.data, update); } };
    assert.equal(requests.length, 0);
    assert.equal('samples' in page.data, false);
    assert.equal('rawInput' in page.data, false);
    assert.equal(page.onInput, undefined);
    assert.equal(page.onScanQR, undefined);
    page.onChooseImage();
    page.onTakePhoto();
    assert.deepEqual(sources, [['album'], ['camera']]);
    choices[0].success({ tempFiles: [{ tempFilePath: 'test-invoice.png' }] });
    await Promise.race([imageComplete, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('二维码读取超时')), 3000))]);
    assert.equal(page.data.parsed.invoiceNumber, '08812453');
    assert.equal(page.data.rows.some((row: { label: string }) => row.label === '版本号' || row.label === '校验码'), false);
    assert.equal(page.data.rows.some((row: { label: string }) => row.label === 'CRC'), true);
    await page.onCheckDuplicate();
    assert.equal(requests.filter((url) => url.endsWith('/invoices/duplicate')).length, 1);
    assert.equal(page.data.dupResult.blocking, false);
    await page.onVerify();
    assert.equal(requests.filter((url) => url.endsWith('/invoices/verify')).length, 1);
    assert.equal(page.data.verifyResult.status, 'valid');
    holdDuplicate = true;
    const oldCheck = page.onCheckDuplicate();
    qrVisible = false;
    const failedImage = new Promise<void>((resolve) => { onImageComplete = resolve; });
    choices[1].success({ tempFiles: [{ tempFilePath: 'unreadable.png' }] });
    pendingDuplicate.success({ statusCode: 200, data: { code: 0, data: { duplicated: false, blocking: false, hits: [] } } });
    await oldCheck;
    await failedImage;
    assert.equal(page.data.parsed, null);
    assert.equal(page.data.dupResult, null);
  } finally {
    (globalThis as any).Page = previousPage;
    (globalThis as any).wx = previousWx;
  }
});
