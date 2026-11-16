import { Button, Select } from 'antd';
import { SaveOutlined, SearchOutlined } from '@ant-design/icons';
import { pinyin } from 'pinyin-pro';
import type { HrEmployee, HrSection } from '../api';

export type EmployeeTab = HrSection | 'transitions' | 'events';
const sections: { key: EmployeeTab; label: string }[] = [
  { key: 'profile', label: '个人信息' }, { key: 'contract', label: '劳动合同' },
  { key: 'salary', label: '定薪与薪资构成' }, { key: 'transitions', label: '调岗与晋升' },
  { key: 'events', label: '人事事件' },
];

interface SearchProps {
  employees: HrEmployee[];
  employeeId?: string;
  onEmployeeChange: (id: string) => void;
}

/** 标题行右侧的员工搜索框：与员工与账号页搜索框同样式，按姓名、拼音、工号、职务匹配。 */
export function EmployeeSearch({ employees, employeeId, onEmployeeChange }: SearchProps) {
  const options = employees.map(employee => ({
    value: employee.id,
    label: `${employee.name} · ${employee.employeeNo} · ${employee.position}${employee.employmentStatus === 'departed' ? ' · 已离职' : ''}`,
    search: [employee.name, pinyin(employee.name, { toneType: 'none' }), employee.employeeNo, employee.position].join(' ').toLowerCase(),
  }));
  return <div className="employee-search-wrap">
    <Select
      className="employee-search-select"
      prefix={<SearchOutlined />}
      aria-label="搜索员工"
      showSearch
      allowClear
      placeholder="搜索姓名 / 拼音 / 工号 / 职务"
      value={employeeId}
      onChange={onEmployeeChange}
      options={options}
      filterOption={(input, option) => String(option?.search ?? '').includes(input.trim().toLowerCase())}
      notFoundContent="未找到员工"
    />
  </div>;
}

interface ToolbarProps {
  employeeId?: string;
  section: EmployeeTab;
  onSectionChange: (section: EmployeeTab) => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
}

export function EmployeeRecordsToolbar({ employeeId, section, onSectionChange, onSave, saving, saveDisabled }: ToolbarProps) {
  const canSave = !!employeeId && (section === 'contract' || section === 'salary') && !saving && !saveDisabled;
  return <div className="filter-bar employee-records-actions" role="toolbar" aria-label="员工档案操作">
    <div className="employee-records-sections" role="group" aria-label="员工档案分类">
      {sections.map(item => <button
        key={item.key}
        type="button"
        className="employee-records-section"
        aria-pressed={!!employeeId && section === item.key}
        disabled={!employeeId}
        onClick={() => onSectionChange(item.key)}
      >{item.label}</button>)}
    </div>
    <Button
      className="filter-primary employee-records-save"
      type="primary"
      aria-label={saving ? '保存中' : '保存'}
      title={saving ? '保存中…' : '保存'}
      icon={<SaveOutlined />}
      loading={saving}
      disabled={!canSave}
      onClick={onSave}
    />
  </div>;
}
