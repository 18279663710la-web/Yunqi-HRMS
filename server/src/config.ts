import dotenv from 'dotenv';
import path from 'node:path';

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** 允许 0（如维护起始小时）；非法则回退。 */
function hour(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : fallback;
}

function str(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

const serverRoot = path.resolve(__dirname, '..');
const localEnv = dotenv.config({ path: path.join(serverRoot, '.env.local') }).parsed;
dotenv.config({ path: path.join(serverRoot, '.env') });

export const DEV_JWT_SECRET = 'yunqi-office-dev-secret';

/** 生产环境必须显式提供非开发默认值；本地未配置时仍使用开发回退值。 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = str(env.JWT_SECRET, DEV_JWT_SECRET);
  if (env.NODE_ENV === 'production' && secret === DEV_JWT_SECRET) {
    throw new Error('生产环境必须通过环境变量 JWT_SECRET 设置强随机密钥');
  }
  return secret;
}

export const config = {
  port: int(process.env.PORT, 3000),
  mysql: {
    host: str(process.env.MYSQL_HOST, '127.0.0.1'),
    port: int(process.env.MYSQL_PORT, 3306),
    user: str(process.env.MYSQL_USER, 'root'),
    password: str(process.env.MYSQL_PASSWORD, ''),
    database: str(process.env.MYSQL_DATABASE, 'yunqi_office'),
    connectionLimit: int(process.env.MYSQL_POOL_SIZE, 10),
  },
  jwt: {
    secret: resolveJwtSecret(),
    accessTtl: str(process.env.JWT_ACCESS_TTL, '7d'),
    refreshTtl: str(process.env.JWT_REFRESH_TTL, '30d'),
  },
  autoMigrate: str(process.env.AUTO_MIGRATE, 'true') !== 'false',
  uploadDir: path.resolve(serverRoot, str(process.env.UPLOAD_DIR, 'uploads')),
  ocrDriver: str(process.env.OCR_DRIVER, 'mock'),
  verifyDriver: str(process.env.VERIFY_DRIVER, 'tencent'),
  expenseAi: {
    driver: str(process.env.EXPENSE_AI_DRIVER, 'deepseek'),
    apiKey: str(localEnv?.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY, ''),
    baseUrl: str(process.env.EXPENSE_AI_BASE_URL, 'https://api.deepseek.com'),
    model: str(process.env.EXPENSE_AI_MODEL, 'deepseek-flash'),
  },
  tencent: {
    secretId: str(process.env.TENCENTCLOUD_SECRET_ID, ''),
    secretKey: str(process.env.TENCENTCLOUD_SECRET_KEY, ''),
    region: str(process.env.TENCENTCLOUD_REGION, 'ap-guangzhou'),
  },
  map: {
    /** 腾讯位置服务 WebServiceAPI Key，用于拜访地址逆解析；未配置时回退“当前位置”。 */
    tencentKey: str(process.env.TENCENT_MAP_KEY ?? process.env.VITE_TENCENT_MAP_KEY, ''),
  },
  wechat: {
    /** 小程序 AppID（与 project.config.json 一致）。两项均配置后微信一键登录才启用。 */
    appid: str(process.env.WECHAT_APPID, ''),
    /** 小程序 AppSecret（公众平台-开发管理-开发设置获取），仅保存在服务端环境变量。 */
    appSecret: str(process.env.WECHAT_APP_SECRET, ''),
  },
  u9ReceiptNotify: {
    /** 与 U9 邮件模板一致，默认只处理江西优科账套。 */
    orgCode: str(process.env.U9_RECEIPT_NOTIFY_ORG_CODE, '001'),
    /** 首次轮询起点，YYYY-MM-DD；留空时使用首次启动当天。 */
    since: str(process.env.U9_RECEIPT_NOTIFY_SINCE, ''),
    lookbackDays: int(process.env.U9_RECEIPT_NOTIFY_LOOKBACK_DAYS, 2),
    pollMs: int(process.env.U9_RECEIPT_NOTIFY_POLL_MS, 60000),
  },
  u9Mirror: {
    /** 员工查询数据源：mysql=镜像；sqlserver=直连（对照/回滚）。本机对照通过后默认 mysql。 */
    querySource: str(process.env.U9_QUERY_SOURCE, 'mysql') === 'sqlserver' ? 'sqlserver' : 'mysql',
    /** 是否启用镜像抽取调度；关闭时不访问 U9 做 ETL。 */
    etlEnabled: str(process.env.U9_ETL_ENABLED, 'true') !== 'false',
    /** 白天增量间隔（毫秒），默认 1 小时。 */
    incrementalMs: int(process.env.U9_ETL_INCREMENTAL_MS, 3600000),
    /** 夜间全量校对起始小时（本地 0–23）。 */
    nightlyHour: int(process.env.U9_ETL_NIGHTLY_HOUR, 2),
    /** 逗号分隔的本地小时，处于这些小时则跳过白天增量。 */
    skipHours: str(process.env.U9_ETL_SKIP_HOURS, '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23),
    /** 单次写入/查询的 ID 分批大小。 */
    batchSize: int(process.env.U9_ETL_BATCH_SIZE, 200),
    /** U9 IN 查询分批大小。 */
    inChunk: int(process.env.U9_ETL_IN_CHUNK, 100),
    /** 进程内查询缓存 TTL（毫秒）。 */
    queryCacheTtlMs: int(process.env.U9_QUERY_CACHE_TTL_MS, 120000),
    /** 增量回看天数（与水位配合，避免边界漏数）。 */
    lookbackDays: int(process.env.U9_ETL_LOOKBACK_DAYS, 3),
    /**
     * 部署全量 / 夜间校对的起点 YYYY-MM-DD；
     * 留空则自动取 U9 应收/收款头表最早业务日期。
     */
    fullSince: str(process.env.U9_ETL_FULL_SINCE, ''),
    /** 启动时若尚无成功同步，是否自动跑一次部署全量。 */
    bootstrapOnStart: str(process.env.U9_ETL_BOOTSTRAP_ON_START, 'true') !== 'false',
    /**
     * 业务模块维护窗（本地小时，半开区间 start <= hour < end）。
     * 默认 0–2：此间 /api/business/* 返回 503；汇总在 nightlyHour 落库。
     */
    businessMaintenanceStartHour: hour(process.env.U9_BUSINESS_MAINTENANCE_START_HOUR, 0),
    businessMaintenanceEndHour: hour(process.env.U9_BUSINESS_MAINTENANCE_END_HOUR, 2),
  },
  corsOrigin: str(process.env.CORS_ORIGIN, '*'),
  admin: {
    username: str(process.env.ADMIN_USERNAME, 'admin'),
    password: str(process.env.ADMIN_PASSWORD, 'admin123456'),
    name: str(process.env.ADMIN_NAME, '系统管理员'),
  },
  demoEmployeePassword: str(process.env.DEMO_EMPLOYEE_PASSWORD, 'Yunqi@123456'),
  serverRoot,
} as const;
