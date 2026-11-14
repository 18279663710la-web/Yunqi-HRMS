import type {
Company,
QuickAction,
TodoStats
} from '../../types/models';
import {
get
} from '../../utils/request';

export function getCompany(): Promise<Company> {
  return get<Company>('/company');
}

export function getQuickActions(): Promise<QuickAction[]> {
  return get<QuickAction[]>('/quick-actions');
}

export function getTodoStats(): Promise<TodoStats> {
  return get<TodoStats>('/todo-stats');
}
