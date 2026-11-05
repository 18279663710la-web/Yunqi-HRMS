/**
 * jsqr.js 是第三方 UMD 构建（Apache-2.0），保持 JS 原样；
 * 这里补一份最小类型声明，供 utils/qr-image.ts 调用。
 */
declare function jsQR(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options?: {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
  }
): { data: string } | null;

export = jsQR;
