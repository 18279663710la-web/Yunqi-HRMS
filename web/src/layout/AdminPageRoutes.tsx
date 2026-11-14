import { Navigate, Route, Routes, type Location } from 'react-router-dom';
import { AdminsPage } from '../modules/admin-accounts/Admins';
import { ApprovalManagementPage } from '../modules/approvals/ApprovalManagement';
import { AttendanceGroupsPage } from '../modules/attendance/AttendanceGroupsPage';
import { AttendanceRecordsPage } from '../modules/attendance/AttendanceRecordsPage';
import { AttendanceVisitsPage } from '../modules/attendance/AttendanceVisitsPage';
import { DashboardPage } from '../modules/dashboard/Dashboard';
import { DepartmentsPage } from '../modules/organization/Departments';
import { EmployeesPage } from '../modules/employees/Employees';
import { HrEmployeesPage, HrLayout, HrOffboardingPage, HrOnboardingPage, HrPayrollBatchesPage, HrPayrollDisbursementPage, HrPayrollRecordsPage, HrPayrollRecordDetailPage } from '../modules/hr/Hr';
import { ModelsFormulasPage } from '../modules/models-formulas/ModelsFormulas';

export function AdminPageRoutes({ location }: { location: Location }) {
  return <Routes location={location}>
    <Route path="/" element={<Navigate to="/dashboard" replace />} />
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/employees" element={<EmployeesPage />} />
    <Route path="/hr" element={<HrLayout />}>
      <Route index element={<Navigate to="/hr/onboarding" replace />} />
      <Route path="onboarding" element={<HrOnboardingPage />} />
      <Route path="employees" element={<HrEmployeesPage />} />
      <Route path="payroll" element={<Navigate to="/hr/payroll-batches" replace />} />
      <Route path="payroll-batches" element={<HrPayrollBatchesPage />} />
      <Route path="payroll-disbursement" element={<HrPayrollDisbursementPage />} />
      <Route path="payroll-records" element={<HrPayrollRecordsPage />} />
      <Route path="payroll-records/:id/:month" element={<HrPayrollRecordDetailPage />} />
      <Route path="offboarding" element={<HrOffboardingPage />} />
      <Route path="*" element={<Navigate to="/hr/onboarding" replace />} />
    </Route>
    <Route path="/attendance" element={<Navigate to="/attendance/groups" replace />} />
    <Route path="/attendance/groups" element={<AttendanceGroupsPage />} />
    <Route path="/attendance/records" element={<AttendanceRecordsPage />} />
    <Route path="/attendance/visits" element={<AttendanceVisitsPage />} />
    <Route path="/models-formulas" element={<Navigate to="/models-formulas/attendance" replace />} />
    <Route path="/models-formulas/attendance" element={<ModelsFormulasPage section="attendance" />} />
    <Route path="/models-formulas/overtime" element={<ModelsFormulasPage section="overtime" />} />
    <Route path="/models-formulas/company-calendar" element={<ModelsFormulasPage section="company-calendar" />} />
    <Route path="/models-formulas/salary" element={<ModelsFormulasPage section="salary" />} />
    <Route path="/models-formulas/onboarding-template" element={<ModelsFormulasPage section="onboarding-template" />} />
    <Route path="/models-formulas/offboarding-template" element={<Navigate to="/models-formulas/attendance" replace />} />
    <Route path="/models-formulas/payroll-workflow" element={<Navigate to="/approvals/leave" replace />} />
    <Route path="/approvals" element={<Navigate to="/approvals/leave" replace />} />
    <Route path="/approvals/custom-workflow" element={<Navigate to="/approvals/leave" replace />} />
    <Route path="/approvals/:type" element={<ApprovalManagementPage />} />
    <Route path="/departments" element={<DepartmentsPage />} />
    <Route path="/admins" element={<AdminsPage />} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>;
}
