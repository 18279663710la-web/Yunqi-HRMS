import { request } from '../../../api/client';
import type { CompanyCalendarRule, CompanyCalendarRuleInput } from '../../../types';

export function fetchCompanyCalendarRules(): Promise<CompanyCalendarRule[]> {
  return request<CompanyCalendarRule[]>('/admin/models-formulas/calendar-rules');
}

export function createCompanyCalendarRule(input: CompanyCalendarRuleInput): Promise<CompanyCalendarRule> {
  return request<CompanyCalendarRule>('/admin/models-formulas/calendar-rules', { method: 'POST', body: input });
}

export function updateCompanyCalendarRule(id: number, input: CompanyCalendarRuleInput): Promise<CompanyCalendarRule> {
  return request<CompanyCalendarRule>(`/admin/models-formulas/calendar-rules/${id}`, { method: 'PUT', body: input });
}

export function deleteCompanyCalendarRule(id: number): Promise<null> {
  return request<null>(`/admin/models-formulas/calendar-rules/${id}`, { method: 'DELETE' });
}
