/**
 * utils/qr-image.ts — 从已有图片中解出二维码（TypeScript）
 *
 * 策略与原实现一致：先按「二维码可能出现的位置」裁剪，再缩放到目标尺寸解码，
 * 而不是无脑把整图缩小（发票二维码在缩图后会低于可解码下限）。
 */

import jsQR from '../lib/jsqr';

export interface DecodeRegion {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DecodeOptions {
  maxEdge?: number;
  zoomEdge?: number;
  invert?: boolean;
  regions?: DecodeRegion[];
}

export interface DecodeResult {
  ok: boolean;
  text: string;
  region: string;
  attempts: number;
  tried: string[];
  imageSize?: string;
  ms?: number;
  message?: string;
}

const DEFAULT_REGIONS: DecodeRegion[] = [
  { key: 'topLeft', x: 0, y: 0, w: 0.6, h: 0.4 },
];

const DEFAULT_OPTIONS: Required<DecodeOptions> = {
  maxEdge: 1600,
  zoomEdge: 1000,
  invert: false,
  regions: DEFAULT_REGIONS,
};

/* ---------------- 纯函数：可直接单测，不依赖 canvas ---------------- */

export function decodePixels(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: { invert?: boolean } = {}
): string {
  if (!data || !width || !height) return '';
  if (typeof jsQR !== 'function') return '';

  const inversionAttempts = options.invert === false ? 'dontInvert' : 'attemptBoth';
  try {
    const res = jsQR(data, width, height, { inversionAttempts });
    return (res && res.data) || '';
  } catch {
    return '';
  }
}

/* ---------------- canvas 相关 ---------------- */

function getCanvasNode(owner: unknown, selector: string): Promise<any | null> {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.createSelectorQuery) {
      resolve(null);
      return;
    }
    const query = wx.createSelectorQuery();
    if (owner && query.in) query.in(owner as WechatMiniprogram.Component.TrivialInstance);
    query
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        const node = (res && res[0] && (res[0] as { node?: unknown }).node) || null;
        resolve(node);
      });
  });
}

function readBase64(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    if (typeof wx === 'undefined' || !wx.getFileSystemManager) {
      resolve('');
      return;
    }
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve((res.data as string) || ''),
      fail: () => resolve(''),
    });
  });
}

function mimeOf(filePath: string): string {
  const p = String(filePath).toLowerCase();
  if (p.includes('.png')) return 'image/png';
  if (p.includes('.webp')) return 'image/webp';
  if (p.includes('.heic')) return 'image/heic';
  return 'image/jpeg';
}

function loadImage(canvas: any, filePath: string): Promise<any | null> {
  return new Promise((resolve) => {
    if (!canvas || !canvas.createImage) {
      resolve(null);
      return;
    }

    const img = canvas.createImage();
    let retried = false;

    const run = async (): Promise<void> => {
      if (retried) {
        resolve(null);
        return;
      }
      retried = true;
      const base64 = await readBase64(filePath);
      if (!base64) {
        resolve(null);
        return;
      }
      img.src = `data:${mimeOf(filePath)};base64,${base64}`;
    };

    img.onerror = () => {
      void run();
    };
    img.onload = () => resolve(img);
    img.src = filePath;
  });
}

function decodeRegion(
  canvas: any,
  ctx: any,
  img: any,
  region: DecodeRegion,
  maxEdge: number,
  invert: boolean
): string {
  const rx = Math.floor(img.width * region.x);
  const ry = Math.floor(img.height * region.y);
  const rw = Math.max(1, Math.floor(img.width * region.w));
  const rh = Math.max(1, Math.floor(img.height * region.h));

  const scale = Math.min(1, maxEdge / Math.max(rw, rh));
  const cw = Math.max(1, Math.round(rw * scale));
  const ch = Math.max(1, Math.round(rh * scale));

  canvas.width = cw;
  canvas.height = ch;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(img, rx, ry, rw, rh, 0, 0, cw, ch);

  const imageData = ctx.getImageData(0, 0, cw, ch);
  return decodePixels(imageData.data, cw, ch, { invert });
}

/* ---------------- 对外接口 ---------------- */

/**
 * 从图片中解出二维码文本
 *
 * @param owner 拥有 canvas 的页面/组件实例（组件内必须传 this）
 * @param selector canvas 选择器，如 '#qrCanvas'
 * @param filePath 图片路径（临时路径 / 用户目录路径 / 网络缓存路径均可）
 */
export async function decodeFromImage(
  owner: unknown,
  selector: string,
  filePath: string,
  options: DecodeOptions = {}
): Promise<DecodeResult> {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const started = Date.now();

  if (!filePath) {
    return { ok: false, text: '', region: '', attempts: 0, tried: [], message: '缺少图片路径' };
  }

  const canvas = await getCanvasNode(owner, selector);
  if (!canvas) {
    return { ok: false, text: '', region: '', attempts: 0, tried: [], message: '页面中没有可用的 canvas 节点' };
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { ok: false, text: '', region: '', attempts: 0, tried: [], message: 'canvas 上下文不可用' };
  }

  const img = await loadImage(canvas, filePath);
  if (!img) {
    return { ok: false, text: '', region: '', attempts: 0, tried: [], message: '图片加载失败' };
  }

  const tried: string[] = [];
  for (const region of opt.regions) {
    const maxEdge = region.key === 'full' ? opt.maxEdge : opt.zoomEdge;
    tried.push(region.key);

    let text = '';
    try {
      text = decodeRegion(canvas, ctx, img, region, maxEdge, opt.invert);
    } catch {
      text = '';
    }

    if (text) {
      return {
        ok: true,
        text,
        region: region.key,
        attempts: tried.length,
        tried,
        imageSize: `${img.width}x${img.height}`,
        ms: Date.now() - started,
      };
    }
  }

  return {
    ok: false,
    text: '',
    region: '',
    attempts: tried.length,
    tried,
    imageSize: `${img.width}x${img.height}`,
    ms: Date.now() - started,
    message: '未识别到左上角发票二维码，请重新拍摄或使用扫码录入',
  };
}

export { DEFAULT_REGIONS, DEFAULT_OPTIONS };
