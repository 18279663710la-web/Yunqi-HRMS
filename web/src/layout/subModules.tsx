import type { ReactNode } from 'react';

import { ApprovalsIcon, AttendanceIcon, HrIcon, ModelsIcon } from './adminIcons';

export interface SubModuleItem {
  key: string;
  label: string;
  superAdminOnly?: boolean;
}

export interface SubModule {
  key: string;
  title: string;
  icon: ReactNode;
  sidebarId: string;
  superAdminOnly?: boolean;
  items: SubModuleItem[];
}

export const SUB_MODULES: SubModule[] = [
  {
    key: '/hr',
    title: '人事管理',
    icon: <HrIcon label="人事管理" />,
    sidebarId: 'hr-sidebar',
    superAdminOnly: true,
    items: [
      { key: '/hr/onboarding', label: '入职管理' },
      { key: '/hr/employees', label: '员工档案' },
      { key: '/hr/payroll-batches', label: '工资批次' },
      { key: '/hr/payroll-disbursement', label: '工资发放' },
      { key: '/hr/payroll-records', label: '工资发放记录' },
      { key: '/hr/offboarding', label: '离职管理' },
    ],
  },
  {
    key: '/attendance',
    title: '考勤管理',
    icon: <AttendanceIcon label="考勤管理" />,
    sidebarId: 'attendance-sidebar',
    items: [
      { key: '/attendance/groups', label: '考勤组' },
      { key: '/attendance/records', label: '考勤明细' },
      { key: '/attendance/visits', label: '拜访记录' },
    ],
  },
  {
    key: '/models-formulas',
    title: '模型与公式',
    icon: <ModelsIcon label="模型与公式" />,
    sidebarId: 'models-formulas-sidebar',
    superAdminOnly: true,
    items: [
      { key: '/models-formulas/attendance', label: '出勤率绩效规则' },
      { key: '/models-formulas/overtime', label: '加班绩效规则' },
      { key: '/models-formulas/company-calendar', label: '公司日历' },
      { key: '/models-formulas/salary', label: '薪资构成模型' },
      { key: '/models-formulas/onboarding-template', label: '入职申请表设置' },
    ],
  },
  {
    key: '/approvals',
    title: '审批管理',
    icon: <ApprovalsIcon label="审批管理" />,
    sidebarId: 'approvals-sidebar',
    items: [
      { key: '/approvals/leave', label: '请假审批' },
      { key: '/approvals/expense', label: '报销审批' },
      { key: '/approvals/overtime', label: '加班审批' },
      { key: '/approvals/travel', label: '出差审批' },
      { key: '/approvals/purchase', label: '采购审批' },
    ],
  },
];

export function accessibleSubModules(role: string | undefined): SubModule[] {
  return SUB_MODULES.filter(module => !module.superAdminOnly || role === 'super_admin')
    .map(module => ({ ...module, items: module.items.filter(item => !item.superAdminOnly || role === 'super_admin') }));
}

const STATIC_TITLES: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/employees': '员工与账号',
  '/approvals': '审批管理',
  '/departments': '组织架构',
  '/admins': '管理员账号',
};

export const PAGE_TITLES: Record<string, string> = {
  ...STATIC_TITLES,
  ...Object.fromEntries(SUB_MODULES.map(module => [module.key, module.title])),
  ...Object.fromEntries(SUB_MODULES.flatMap(module => module.items.map(item => [item.key, item.label]))),
};

export function matchSubModule(pathname: string): SubModule | undefined {
  return SUB_MODULES.find(module => pathname === module.key || pathname.startsWith(`${module.key}/`));
}

export function resolvePageKey(pathname: string): string {
  const matches = Object.keys(PAGE_TITLES).filter(key => pathname === key || pathname.startsWith(`${key}/`));
  return matches.sort((left, right) => right.length - left.length)[0] ?? '/dashboard';
}

export function subModuleLabel(pathname: string): string | undefined {
  return SUB_MODULES.flatMap(module => module.items).find(item => item.key === pathname)?.label;
}

export interface SubModuleMetrics {
  sidebarWidth: number;
  itemWidth: number;
}

export function subModuleMetrics(module: SubModule): SubModuleMetrics {
  const longestItem = Math.max(1, ...module.items.map(item => Array.from(item.label).length));
  const itemWidth = longestItem * 13 + 32;
  return { sidebarWidth: itemWidth + 24, itemWidth };
}
