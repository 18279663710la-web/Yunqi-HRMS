/** 开发者工具运行在后端所在电脑；真机使用单独配置的网络地址。 */
export function apiOriginForPlatform(platform: string, deviceOrigin: string): string {
  return platform === 'devtools' ? 'http://127.0.0.1:3100' : deviceOrigin;
}
