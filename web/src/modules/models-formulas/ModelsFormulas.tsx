import { Alert } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import type { AdminRole } from '../../types';
import { OnboardingTemplateSettings } from './onboarding-template/OnboardingTemplateSettings';
import { PayrollAttendanceRules } from './attendance/PayrollAttendanceRules';
import { PayrollOvertimeRules } from './overtime/PayrollOvertimeRules';
import { SalaryModels } from './salary/SalaryModels';
import { CompanyCalendar } from './company-calendar/CompanyCalendar';

const ruleSaved = () => {};
export type FormulaSection = 'attendance' | 'overtime' | 'company-calendar' | 'salary' | 'onboarding-template';

export function ModelsFormulasView({ role, section }: { role: AdminRole | undefined; section: FormulaSection }) {
  if (role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问模型与公式" />;
  const content = {
    attendance: <PayrollAttendanceRules onSaved={ruleSaved} />,
    overtime: <PayrollOvertimeRules onSaved={ruleSaved} />,
    'company-calendar': <CompanyCalendar />,
    salary: <SalaryModels />,
    'onboarding-template': <OnboardingTemplateSettings />,
  }[section];
  return content;
}

export function ModelsFormulasPage({ section }: { section: FormulaSection }) {
  const { admin } = useAuth();
  return <ModelsFormulasView role={admin?.role} section={section} />;
}
