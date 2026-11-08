import { Select } from 'antd';
import type { HrEmployee, HrSection } from '../api';

export type EmployeeTab = HrSection | 'transitions' | 'events';
const sections: { key: EmployeeTab; label: string }[] = [
  { key: 'profile', label: '个人信息' }, { key: 'contract', label: '劳动合同' },
  { key: 'salary', label: '定薪与薪资构成' }, { key: 'transitions', label: '调岗与晋升' },
  { key: 'events', label: '人事事件' },
];

interface Props {
  employees: HrEmployee[];
  employeeId?: string;
  section: EmployeeTab;
  onEmployeeChange: (id: string) => void;
  onSectionChange: (section: EmployeeTab) => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
}

export function EmployeeRecordsToolbar({ employees, employeeId, section, onEmployeeChange, onSectionChange, onSave, saving, saveDisabled }: Props) {
  const options = employees.map(employee => ({ value: employee.id, label: `${employee.name} · ${employee.employeeNo} · ${employee.position}${employee.employmentStatus === 'departed' ? ' · 已离职' : ''}` }));
  const canSave = !!employeeId && (section === 'contract' || section === 'salary') && !saving && !saveDisabled;
  return <div className="salary-model-entries employee-records-toolbar" role="toolbar" aria-label="员工档案操作">
    <Select aria-label="选择员工" showSearch optionFilterProp="label" placeholder="选择员工" value={employeeId} onChange={onEmployeeChange} options={options} className="employee-records-select" />
    <div className="employee-records-sections" role="group" aria-label="员工档案分类">
      {sections.map(item => <button key={item.key} type="button" className="salary-model-entry employee-records-section" aria-pressed={!!employeeId && section === item.key} disabled={!employeeId} onClick={() => onSectionChange(item.key)}>{item.label}</button>)}
    </div>
    <button type="button" className="salary-model-entry employee-records-save" disabled={!canSave} onClick={onSave}>{saving ? '保存中…' : '保存'}</button>
  </div>;
}
