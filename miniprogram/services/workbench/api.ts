import type {
Company,
QuickAction,
TodoStats
} from '../../types/models';
import {
get,
post
} from '../../utils/request';

export async function resetDemoData(): Promise<void> {
  await post('/demo/reset', {});
}

export function getCompany(): Promise<Company> {
  return get<Company>('/company');
}

export function getQuickActions(): Promise<QuickAction[]> {
  return get<QuickAction[]>('/quick-actions');
}

export function getTodoStats(): Promise<TodoStats> {
  return get<TodoStats>('/todo-stats');
}
