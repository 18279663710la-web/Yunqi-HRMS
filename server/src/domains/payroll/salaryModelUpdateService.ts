import { transaction } from '../../shared/db/pool';
import { conflict } from '../../shared/utils/errors';
import { normalizeModelInput, normalizeStoredModel, readSalaryModel, reconcileSalaryFieldOrder, synchronizeSalaryRecord, validateSalaryFieldOrder } from './salaryModelService';
import type { SalaryModelInput } from './salaryModelSchema';
import * as repository from './salaryModelRepository';

export const SALARY_MODEL_KEY = 'salary_component_model';

export async function saveSalaryModel(input: SalaryModelInput) {
  const normalized = normalizeModelInput(input.fixedFields, input.extendedFields);
  const names = [...normalized.fixedFields, ...normalized.extendedFields].map(field => field.name);
  const requestedOrder = input.fieldOrder === undefined ? undefined : validateSalaryFieldOrder(input.fieldOrder, names);
  const fallback = await readSalaryModel();
  return transaction(async conn => {
    const current = normalizeStoredModel(await repository.ensureAndLockModel(conn, SALARY_MODEL_KEY, fallback));
    if (current.version !== input.version) throw conflict('模型已被修改，请刷新后重试');
    const fieldOrder = requestedOrder ?? (current.fieldOrder ? reconcileSalaryFieldOrder(current.fieldOrder, names) : undefined);
    const next = { version: current.version + 1, fixedFields: normalized.fixedFields, extendedFields: normalized.extendedFields, ...(fieldOrder ? { fieldOrder } : {}) };
    const salaryStructure = (fields: typeof current.fixedFields) => fields.map(({ displaySetting: _displaySetting, ...field }) => field);
    if (JSON.stringify(salaryStructure(current.fixedFields)) !== JSON.stringify(salaryStructure(next.fixedFields))) {
      const salaryRows = await repository.lockSalaryRecords(conn);
      for (const row of salaryRows) {
        const original = typeof row.data_json === 'string' ? JSON.parse(row.data_json) : row.data_json;
        const updated = synchronizeSalaryRecord(original, current, next);
        const changed = JSON.stringify({ values: original.values, base: original.base, allowance: original.allowance, performance: original.performance }) !== JSON.stringify({ values: updated.values, base: updated.base, allowance: updated.allowance, performance: updated.performance });
        if (changed) {
          if (!await repository.hasSalaryHistory(conn, row.employee_id)) await repository.saveSalaryHistory(conn, row.employee_id, original, row.updated_at);
          await repository.saveSalaryHistory(conn, row.employee_id, updated);
        }
        await repository.updateSalaryRecord(conn, row.employee_id, updated);
      }
    }
    await repository.updateModel(conn, SALARY_MODEL_KEY, next);
    return next;
  });
}
