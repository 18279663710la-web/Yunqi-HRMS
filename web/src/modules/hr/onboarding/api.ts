export const ONBOARDING_FORM_URL = '/admin/onboarding-form';

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'table';

export interface Field {
  name: string;
  type: FieldType;
  required: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
  children?: Field[];
}

export interface Template {
  id: number;
  name: string;
  fields: Field[];
  version: number;
  isDefault: boolean;
}

export interface TemplateSnapshot {
  name: string;
  fields: Field[];
}

export interface TemplateChange {
  label: string;
  before?: unknown;
  after?: unknown;
}

export interface TemplateHistoryEntry {
  id: number;
  templateId: number;
  templateName: string;
  action: 'create' | 'update' | 'delete';
  before: TemplateSnapshot | null;
  after: TemplateSnapshot | null;
  changes: TemplateChange[];
  adminName: string;
  createdAt: string;
}
