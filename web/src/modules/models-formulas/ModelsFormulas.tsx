import { Alert, Card } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { OnboardingTemplateSettings } from './onboarding-template/OnboardingTemplateSettings';
import { PayrollAttendanceRules } from './attendance/PayrollAttendanceRules';
import { PayrollOvertimeRules } from './overtime/PayrollOvertimeRules';
import { PayrollWorkflow } from './payroll-workflow/PayrollWorkflow';
import { SalaryModels } from './salary/SalaryModels';

const ruleSaved = () => {};
export type FormulaSection = 'attendance' | 'overtime' | 'salary' | 'onboarding-template' | 'payroll-workflow';

export function ModelsFormulasView({ role, section }: { role: AdminRole | undefined; section: FormulaSection }) {
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问模型与公式" />;
  const content = {
    attendance: <PayrollAttendanceRules onSaved={ruleSaved} />,
    overtime: <PayrollOvertimeRules onSaved={ruleSaved} />,
    salary: <SalaryModels />,
    'onboarding-template': <OnboardingTemplateSettings />,
    'payroll-workflow': <PayrollWorkflow />,
  }[section];
  if (section === 'payroll-workflow' || section === 'salary') return content;
  return <div className="page-stack">
    <Card className="panel-card" bordered={false}>
      <div className="page-stack">{content}</div>
    </Card>
  </div>;
}

export function ModelsFormulasPage({ section }: { section: FormulaSection }) {
  const { admin } = useAuth();
  return <ModelsFormulasView role={admin?.role} section={section} />;
}
