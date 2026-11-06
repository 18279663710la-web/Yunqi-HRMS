import { orderedSalaryFields, SALARY_IDENTITY_FIELDS } from '../../models-formulas/salary/salaryModel';
import type { PayrollModelSnapshot, SalaryComponentModel } from '../api';

/** 按模型顺序展示现有字段，并保留历史工资快照中的旧字段。 */
export function payrollFieldNames(model: SalaryComponentModel | null | undefined, snapshots: Array<PayrollModelSnapshot | null | undefined>): string[] {
  const modelNames = model ? orderedSalaryFields(model).map(field => field.name) : SALARY_IDENTITY_FIELDS.map(field => field.name);
  const historicalNames = snapshots.flatMap(snapshot => [...(snapshot?.fixed ?? []), ...(snapshot?.extended ?? [])].map(field => field.name));
  return [...new Set([...modelNames, ...historicalNames])];
}
