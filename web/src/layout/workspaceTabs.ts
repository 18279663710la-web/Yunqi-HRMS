import type { Location } from 'react-router-dom';
import { PAGE_TITLES, resolvePageKey } from './subModules';

export interface WorkspaceTab { key: string; label: string; location: Location }
const HOME_KEY = '/dashboard';
const approvalTitles: Record<string, string> = {
  '/approvals/leave': '请假审批', '/approvals/expense': '报销审批', '/approvals/overtime': '加班审批',
  '/approvals/travel': '出差审批', '/approvals/purchase': '采购审批',
};
const aliases: Record<string, string> = {
  '/': HOME_KEY, '/hr': '/hr/onboarding', '/hr/payroll': '/hr/payroll-batches',
  '/models-formulas': '/models-formulas/attendance', '/approvals': '/approvals/leave',
};
const homeLocation: Location = { pathname: HOME_KEY, search: '', hash: '', state: null, key: 'workspace-home' };

export function workspaceTabForLocation(location: Location): WorkspaceTab {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const record = /^\/hr\/payroll-records\/(\d+)\/(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(path);
  if (record) return { key: path, label: `${record[2]}发放记录 #${record[1]}`, location };
  const fallback = resolvePageKey(path);
  const key = aliases[path] ?? (approvalTitles[path] ? path : aliases[fallback] ?? fallback);
  return { key, label: key === HOME_KEY ? '首页' : approvalTitles[key] ?? PAGE_TITLES[key] ?? '首页', location };
}

export function createWorkspaceTabs(location: Location): WorkspaceTab[] {
  const current = workspaceTabForLocation(location);
  const home = workspaceTabForLocation(homeLocation);
  return current.key === HOME_KEY ? [current] : [home, current];
}

export function openWorkspaceTab(tabs: WorkspaceTab[], location: Location): WorkspaceTab[] {
  const next = workspaceTabForLocation(location);
  const index = tabs.findIndex(tab => tab.key === next.key);
  if (index < 0) return [...tabs, next];
  if (tabs[index].location === location) return tabs;
  return tabs.map((tab, i) => i === index ? next : tab);
}

export function closeWorkspaceTab(tabs: WorkspaceTab[], key: string, activeKey: string): { tabs: WorkspaceTab[]; nextLocation: Location | null } {
  const index = tabs.findIndex(tab => tab.key === key);
  if (key === HOME_KEY || index < 0) return { tabs, nextLocation: null };
  const nextLocation = key === activeKey ? (tabs[index + 1] ?? tabs[index - 1]).location : null;
  return { tabs: tabs.filter(tab => tab.key !== key), nextLocation };
}
