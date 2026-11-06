import type { SalaryComponentModel, SalaryComponentModelInput, SalaryFieldRole, SalaryModelField } from '../../hr/api';

export function orderedSalaryFields(model: SalaryComponentModel | null | undefined): SalaryModelField[] {
  if (!model) return [];
  const fields = [...model.fixedFields, ...model.extendedFields];
  const byName = new Map(fields.map(field => [field.name, field]));
  const ordered = [...new Set(model.fieldOrder ?? [])].map(name => byName.get(name)).filter((field): field is SalaryModelField => !!field);
  const used = new Set(ordered.map(field => field.name));
  return [...ordered, ...fields.filter(field => !used.has(field.name))];
}

export function moveSalaryField(names: readonly string[], source: string, target: string, side: 'before' | 'after'): string[] {
  if (source === target || !names.includes(source) || !names.includes(target)) return [...names];
  const result = names.filter(name => name !== source);
  const targetIndex = result.indexOf(target);
  result.splice(targetIndex + (side === 'after' ? 1 : 0), 0, source);
  return result;
}

export const SALARY_IDENTITY_FIELDS: SalaryModelField[] = [
  { name: '姓名', type: 'text', required: true, role: 'name' },
  { name: '员工号', type: 'text', required: true, role: 'employeeNo' },
  { name: '职务', type: 'text', required: true, role: 'position' },
];
const IDENTITY_NAMES = new Set(SALARY_IDENTITY_FIELDS.map(field => field.name));
const AMOUNT_ROLES: SalaryFieldRole[] = ['base', 'allowance', 'performance'];

export interface SalaryModelFieldGroups {
  fixedFields: SalaryModelField[];
  extendedFields: SalaryModelField[];
}

export function isSalaryIdentityField(field: Partial<SalaryModelField> | undefined): boolean {
  return field?.role === 'name' || field?.role === 'employeeNo' || field?.role === 'position' || (typeof field?.name === 'string' && IDENTITY_NAMES.has(field.name.trim()));
}

export function salaryAmountFields(model: { fixedFields: SalaryModelField[] } | null | undefined): SalaryModelField[] {
  return (model?.fixedFields ?? []).filter(field => !isSalaryIdentityField(field));
}

export function buildSalaryModelGroups(
  fixedFields: Array<Partial<SalaryModelField> | undefined> | undefined,
  extendedFields: Array<Partial<SalaryModelField> | undefined> | undefined,
  identities?: Array<Partial<SalaryModelField> | undefined>
): SalaryModelFieldGroups {
  const identityNames = SALARY_IDENTITY_FIELDS.map(field => field.name);
  const normalizeAmount = (fields: Array<Partial<SalaryModelField> | undefined> | undefined): SalaryModelField[] =>
    (fields ?? []).filter(field => !isSalaryIdentityField(field)).map(field => {
      const name = (field?.name ?? '').trim();
      const type = field?.type ?? 'number';
      const role = type === 'number' && field?.role && AMOUNT_ROLES.includes(field.role) ? field.role : undefined;
      return { name, type, required: field?.required !== false, ...(role ? { role } : {}), ...(field?.category ? { category: field.category } : {}), ...(field?.interfaceSource === 'attendance' ? { interfaceSource: field.interfaceSource } : {}), ...(field?.interfaceSource === 'attendance' && field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}), ...(field?.interfaceSource === 'attendance' && field.calculationRule ? { calculationRule: field.calculationRule } : {}), ...(field?.displaySetting && field.displaySetting !== 'none' ? { displaySetting: field.displaySetting } : {}) };
    });
  const normalizeExtended = (fields: Array<Partial<SalaryModelField> | undefined> | undefined): SalaryModelField[] =>
    (fields ?? []).map(field => ({
      name: (field?.name ?? '').trim(),
      type: field?.type ?? 'number',
      required: field?.required !== false,
      category: field?.category ?? 'info',
      ...(field?.interfaceSource === 'attendance' ? { interfaceSource: field.interfaceSource } : {}), ...(field?.interfaceSource === 'attendance' && field.attendanceMetric ? { attendanceMetric: field.attendanceMetric } : {}),
      ...(field?.interfaceSource === 'attendance' && field.calculationRule ? { calculationRule: field.calculationRule } : {}),
      ...(field?.displaySetting && field.displaySetting !== 'none' ? { displaySetting: field.displaySetting } : {}),
    }));
  const fixed = normalizeAmount(fixedFields);
  const extended = normalizeExtended(extendedFields);
  const names = [...identityNames, ...fixed.map(field => field.name), ...extended.map(field => field.name)];
  if (fixed.some(field => !field.name) || extended.some(field => !field.name)) throw new Error('请输入字段名称');
  if (fixed.some(field => IDENTITY_NAMES.has(field.name)) || extended.some(field => IDENTITY_NAMES.has(field.name))) throw new Error('姓名、员工号和职务是固定字段，不能重复添加');
  if (new Set(names).size !== names.length) throw new Error('字段名称不能重复');
  if ([...fixed, ...extended].some(field => field.type === 'text' && field.category && field.category !== 'info')) throw new Error('字符串字段用途只能是仅记录');
  if (names.length > 51) throw new Error('最多配置 51 个字段');
  const fixedIdentities = SALARY_IDENTITY_FIELDS.map(field => {
    const displaySetting = identities?.find(item => item?.role === field.role)?.displaySetting;
    return { ...field, ...(displaySetting && displaySetting !== 'none' ? { displaySetting } : {}) };
  });
  return { fixedFields: [...fixedIdentities, ...fixed], extendedFields: extended };
}

export type SalaryFieldChange =
  | { action: 'create'; group: 'fixed' | 'extended'; field: SalaryModelField }
  | { action: 'edit'; group: 'fixed' | 'extended'; name: string; field: SalaryModelField }
  | { action: 'delete'; group: 'fixed' | 'extended'; name: string };

export function applySalaryFieldChange(model: SalaryComponentModel, change: SalaryFieldChange): SalaryComponentModelInput {
  const fixed = [...model.fixedFields];
  const extended = [...model.extendedFields];
  const target = change.group === 'fixed' ? fixed : extended;
  let renamed: string | undefined;
  if (change.action === 'create') {
    if (isSalaryIdentityField(change.field)) throw new Error('姓名、员工号和职务是固定字段，不能重复添加');
    target.push(change.field);
  } else {
    const index = target.findIndex(field => field.name === change.name);
    if (index < 0) throw new Error('字段不存在，请刷新后重试');
    const previous = target[index];
    if (isSalaryIdentityField(previous)) {
      if (change.action === 'delete') throw new Error('姓名、员工号和职务不能删除');
      target[index] = { ...previous, displaySetting: change.field.displaySetting ?? 'none' };
    } else if (change.action === 'delete') {
      target.splice(index, 1);
    } else {
      if (isSalaryIdentityField(change.field)) throw new Error('姓名、员工号和职务是固定字段，不能重复添加');
      target[index] = { ...previous, ...change.field };
      renamed = change.field.name.trim();
    }
  }
  const groups = buildSalaryModelGroups(fixed, extended, fixed.filter(isSalaryIdentityField));
  if (!model.fieldOrder) return { version: model.version, ...groups };
  const names = [...groups.fixedFields, ...groups.extendedFields].map(field => field.name);
  const ordered = model.fieldOrder.map(name => change.action === 'edit' && name === change.name && renamed ? renamed : name).filter(name => names.includes(name));
  const existing = new Set(ordered);
  return { version: model.version, ...groups, fieldOrder: [...ordered, ...names.filter(name => !existing.has(name))] };
}
