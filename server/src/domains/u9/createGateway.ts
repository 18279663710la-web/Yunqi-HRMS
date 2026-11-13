import { config } from '../../config';
import { mirrorU9 } from './mirrorGateway';
import { sqlServerU9 } from './sqlServerGateway';
import type { U9Gateway } from './types';

/** 员工/管理端查询网关；ETL 抽取仍直接使用 sqlServer 单表 API。 */
export function createEmployeeU9Gateway(): U9Gateway {
  return config.u9Mirror.querySource === 'mysql' ? mirrorU9 : sqlServerU9;
}
