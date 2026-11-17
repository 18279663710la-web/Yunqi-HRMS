import { config } from '../../config';
import { logModule } from '../../shared/logging/logger';

export interface GeocodeResult {
  name: string;
  address: string;
  resolved: boolean;
}

interface TencentGeocodeResult {
  address?: string;
  formatted_addresses?: {
    recommend?: string;
    rough?: string;
  };
  pois?: Array<{ title?: string }>;
}

interface TencentGeocodeResponse {
  status?: number;
  message?: string;
  result?: TencentGeocodeResult;
}

const FALLBACK: GeocodeResult = { name: '当前位置', address: '当前位置', resolved: false };

function clean(value: string | undefined, maxLength: number): string {
  return String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, maxLength);
}

/** 解析腾讯位置服务逆地址结果；导出用于测试。 */
export function parseTencentGeocode(data: TencentGeocodeResponse | null | undefined): GeocodeResult {
  if (!data || data.status !== 0 || !data.result) return FALLBACK;
  const result = data.result;
  const poiName = clean(result.pois?.[0]?.title, 100);
  const recommend = clean(result.formatted_addresses?.recommend, 100);
  const rough = clean(result.formatted_addresses?.rough, 100);
  const address = clean(result.address, 255);
  const rawName = poiName || recommend || rough;
  const resolved = Boolean(rawName || address);
  return {
    name: rawName || address || '当前位置',
    address: address || rawName || '当前位置',
    resolved,
  };
}

/** 将 GCJ-02 经纬度解析为地图地点名称；未配置 Key 或调用失败时回退“当前位置”。 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult> {
  const key = config.map.tencentKey;
  if (!key) return FALLBACK;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL('https://apis.map.qq.com/ws/geocoder/v1/');
    url.searchParams.set('location', `${latitude},${longitude}`);
    url.searchParams.set('key', key);
    url.searchParams.set('get_poi', '1');
    url.searchParams.set('output', 'json');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      logModule('miniprogram', 'attendance', 'warn', `拜访逆地址解析请求失败：HTTP ${response.status}`);
      return FALLBACK;
    }
    const data = await response.json() as TencentGeocodeResponse;
    const parsed = parseTencentGeocode(data);
    if (!parsed.resolved && data.status !== 0) {
      logModule('miniprogram', 'attendance', 'warn', `拜访逆地址解析未返回结果：${data.status} ${data.message || ''}`);
    }
    return parsed;
  } catch (error) {
    logModule('miniprogram', 'attendance', 'warn', `拜访逆地址解析异常：${(error as Error).message}`);
    return FALLBACK;
  } finally {
    clearTimeout(timer);
  }
}
