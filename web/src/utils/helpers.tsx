import type { ReactNode } from 'react';
import { Tag } from 'antd';

import type { AccountStatus, AdminRole, DepartmentNode, JobCategoryName } from '../types';

const JOB_CATEGORY_COLOR: Record<JobCategoryName, string> = {
  研发员: '#8BA6C1',
  业务员: '#C9A75C',
  员工: '#A18BC2',
};

export function jobCategoryTag(category: JobCategoryName): ReactNode {
  return <Tag color={JOB_CATEGORY_COLOR[category]}>{category}</Tag>;
}

export interface FlatDepartment {
  value: string;
  label: string;
  name: string;
  depth: number;
  total: number;
  leaderName: string;
}

export function flattenDepartments(nodes: DepartmentNode[], depth = 0): FlatDepartment[] {
  return nodes.flatMap((node) => [
    {
      value: node.id,
      label: `${'　'.repeat(depth)}${depth ? '└ ' : ''}${node.name}`,
      name: node.name,
      depth,
      total: node.total,
      leaderName: node.leaderName,
    },
    ...flattenDepartments(node.children, depth + 1),
  ]);
}

export function roleLabel(role: AdminRole): string {
  return role === 'super_admin' ? '超级管理员' : 'HR 管理员';
}

export function accountStatusTag(status: AccountStatus | 'none'): ReactNode {
  if (status === 'active') return <Tag color="success">已启用</Tag>;
  if (status === 'disabled') return <Tag color="error">已停用</Tag>;
  return <Tag>未开通</Tag>;
}

const ATTENDANCE_TAG: Record<string, { color: string; text: string }> = {
  normal: { color: 'success', text: '正常' },
  missing_in: { color: 'warning', text: '未打上班卡' },
  missing_out: { color: 'warning', text: '未打下班卡' },
  absent: { color: 'error', text: '缺卡' },
  leave: { color: 'processing', text: '请假' },
  rest: { color: 'default', text: '休息' },
  travel: { color: '#7FB2B0', text: '出差' },
};

export function attendanceTag(status: string, text?: string): ReactNode {
  const meta = ATTENDANCE_TAG[status] || { color: 'default', text: status };
  return <Tag color={meta.color}>{text || meta.text}</Tag>;
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>): void {
  const escape = (value: string | number | null | undefined): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const content = `\ufeff${rows.map((row) => row.map(escape).join(',')).join('\n')}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function initialOf(name: string): string {
  return name ? name.slice(0, 1) : '?';
}
