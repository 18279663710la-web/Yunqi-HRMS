import { z } from 'zod';

const fieldNameSchema = z.string().trim().min(1, '请输入字段名称').max(60);
const fieldSchema = z.union([
  fieldNameSchema.transform(name => ({ name, type: 'number' as const, required: true })),
  z.object({
    name: fieldNameSchema,
    type: z.enum(['number', 'text']).default('number'),
    required: z.boolean().default(true),
    role: z.enum(['name', 'employeeNo', 'position', 'base', 'allowance', 'performance']).optional(),
    category: z.enum(['income', 'deduction', 'info']).optional(),
    interfaceSource: z.enum(['none', 'attendance']).optional(),
    displaySetting: z.enum(['none', 'display', 'output']).optional(),
  }),
]);
export const salaryModelInputSchema = z.object({
  version: z.number().int().positive().safe(),
  fixedFields: z.array(fieldSchema).default([]),
  extendedFields: z.array(fieldSchema).default([]),
  fieldOrder: z.array(fieldNameSchema).max(51).optional(),
});
export type SalaryModelInput = z.infer<typeof salaryModelInputSchema>;
