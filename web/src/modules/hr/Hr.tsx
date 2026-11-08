import { useEffect, useState } from 'react';
import { App, Alert, Card, Empty, Form, Input, InputNumber, Spin, Typography } from 'antd';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { PageTitle } from '../../components/PageTitle';
import { subModuleLabel } from '../../layout/subModules';
import { OnboardingSubmission, type ArchivedOnboarding } from './onboarding/OnboardingSubmission';
import { request } from '../../api/client';
import { OnboardingForms } from './onboarding/OnboardingForms';
import { HrEvents, HrRecordHistory } from './employee-records/HrEvents';
import { HrPayrollBatches } from './payroll/HrPayrollBatches';
import { HrPayrollDisbursement, HrPayrollRecords } from './payroll/HrPayrollDisbursement';
import { PayrollRecordDetail } from './payroll/PayrollRecordDetail';
import { HrOffboarding } from './offboarding/HrOffboarding';
import { HrTransitions } from './employee-records/HrTransitions';
import { HrContractFiles } from './employee-records/HrContractFiles';
import { getHrEmployees, getHrRecord, getSalaryComponentModel, saveHrRecord, type HrEmployee, type SalaryComponentModel } from './api';
import { salaryAmountFields } from '../models-formulas/salary/salaryModel';
import { salaryRecordPayload } from './employee-records/salaryRecordPayload';
import { EmployeeRecordsToolbar, type EmployeeTab } from './employee-records/EmployeeRecordsToolbar';
import './employee-records/employeeRecords.css';

const { Text } = Typography;
function EmployeeRecords({ employees, archiveRevision, refreshEmployees }: { employees: HrEmployee[]; archiveRevision: number; refreshEmployees: () => Promise<void> }) {
  const { message } = App.useApp();
  const [employeeId, setEmployeeId] = useState<string>();
  const [section, setSection] = useState<EmployeeTab>('profile');
  const [archived, setArchived] = useState<ArchivedOnboarding | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [salaryModel, setSalaryModel] = useState<SalaryComponentModel | null>(null);
  const [salaryModelFailed, setSalaryModelFailed] = useState(false);
  const [form] = Form.useForm();
  const profileRevision = section === 'profile' ? archiveRevision : 0;
  useEffect(() => {
    form.resetFields(); setArchived(null); setLoadFailed(false);
    if (!employeeId || section === 'transitions' || section === 'events') { setLoading(false); return; }
    let active = true; setLoading(true);
    const load = section === 'profile'
      ? request<ArchivedOnboarding | null>(`/admin/onboarding-form/archived/${encodeURIComponent(employeeId)}`).then(data => { if (active) setArchived(data); })
      : getHrRecord(employeeId, section).then(data => { if (active) form.setFieldsValue(data); });
    load.catch((error: Error) => { if (active) { setLoadFailed(true); message.error(error.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, section, profileRevision]);
  useEffect(() => {
    if (section !== 'salary' || salaryModel) return;
    let active = true;
    setSalaryModelFailed(false);
    getSalaryComponentModel().then(value => { if (active) setSalaryModel(value); }).catch((error: Error) => { if (active) setSalaryModelFailed(true); message.error(error.message); });
    return () => { active = false; };
  }, [section, salaryModel]);
  const salaryFields = salaryAmountFields(salaryModel);
  const currentPosition = employees.find(employee => employee.id === employeeId)?.position ?? '';
  const save = async (data: Record<string, unknown>) => {
    if (!employeeId || (section !== 'contract' && section !== 'salary')) return;
    if (section === 'salary' && (!salaryModel || salaryModelFailed)) { message.error('薪资构成模型加载失败'); return; }
    setSaving(true);
    try {
      const payload = section === 'salary' ? salaryRecordPayload(data, salaryModel!.version) : data;
      await saveHrRecord(employeeId, section, payload);
      setRevision(value => value + 1); message.success('人事资料已保存');
    }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  return <div className="employee-records-page">
    <EmployeeRecordsToolbar employees={employees} employeeId={employeeId} section={section} onEmployeeChange={setEmployeeId} onSectionChange={setSection} onSave={() => form.submit()} saving={saving} saveDisabled={loading || loadFailed || (section === 'salary' && (!salaryModel || salaryModelFailed))} />
      {employeeId ? <>
        {section === 'profile' && <Spin spinning={loading}>{!loading && (loadFailed ? <Alert type="error" message="个人信息加载失败" /> : archived ? <OnboardingSubmission record={archived} /> : <Empty description="该员工暂无已封存的入职申请表" />)}</Spin>}
        {(section === 'contract' || section === 'salary') && <><Spin spinning={loading}><Form form={form} layout="vertical" onFinish={save} style={{ maxWidth: 600 }}>
          {section === 'contract' && <><Form.Item name="number" label="合同编号" rules={[{ required: true, whitespace: true, message: '请填写合同编号' }]}><Input maxLength={200} /></Form.Item><Form.Item name="startDate" label="合同开始日期" rules={[{ required: true, message: '请选择合同开始日期' }]}><Input type="date" /></Form.Item><Form.Item name="endDate" label="合同结束日期" dependencies={['startDate']} rules={[{ required: true, message: '请选择合同结束日期' }, ({ getFieldValue }) => ({ validator(_, value: string) { return !value || !getFieldValue('startDate') || value >= getFieldValue('startDate') ? Promise.resolve() : Promise.reject(new Error('合同结束日期不能早于开始日期')); } })]}><Input type="date" /></Form.Item><Form.Item name="note" label="备注"><Input.TextArea maxLength={200} /></Form.Item></>}
          {section === 'salary' && <><Form.Item label="职务"><Text>{currentPosition || '—'}</Text></Form.Item><Form.Item name="effectiveDate" label="定薪生效日期"><Input type="date" /></Form.Item>{salaryModelFailed ? <Alert type="error" message="薪资构成模型加载失败" /> : salaryModel ? (salaryFields.length ? salaryFields.map(field => <Form.Item key={field.name} name={['values', field.name]} label={field.type === 'number' && field.category !== 'info' ? `${field.name}（元）` : field.name} rules={field.required ? [{ required: true, message: `请填写${field.name}` }] : undefined}>{field.type === 'text' ? <Input maxLength={200} /> : <InputNumber min={0} max={9999999999.99} precision={2} style={{ width: '100%' }} />}</Form.Item>) : <Empty description="暂无固定薪资字段" />) : null}<Form.Item name="note" label="备注"><Input.TextArea maxLength={200} /></Form.Item></>}
        </Form></Spin>{section === 'contract' && <HrContractFiles key={employeeId} employeeId={employeeId} />}<HrRecordHistory employeeId={employeeId} section={section} revision={revision} /></>}
        {section === 'transitions' && <HrTransitions key={`transitions-${employeeId}`} employeeId={employeeId} onEmployeeChanged={refreshEmployees} />}
        {section === 'events' && <HrEvents key={`events-${employeeId}`} employeeId={employeeId} />}
      </> : <Empty description="请选择员工查看人事资料" />}
  </div>;
}

interface HrLayoutContext {
  employees: HrEmployee[];
  archiveRevision: number;
  markArchiveChanged: () => void;
  refreshEmployees: () => Promise<void>;
}

export function HrLayout() {
  const { admin } = useAuth();
  const { message } = App.useApp();
  const location = useLocation();
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [archiveRevision, setArchiveRevision] = useState(0);
  const workspaceActive = useWorkspaceActive();
  useEffect(() => {
    if (!workspaceActive || admin?.role !== 'super_admin') return;
    let active = true;
    getHrEmployees().then(rows => { if (active) setEmployees(rows); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [admin?.role, workspaceActive]);
  if (admin?.role !== 'super_admin') return <Alert type="warning" message="仅超级管理员可访问人事管理" />;
  const context: HrLayoutContext = {
    employees,
    archiveRevision,
    markArchiveChanged: () => setArchiveRevision(value => value + 1),
    refreshEmployees: async () => setEmployees(await getHrEmployees()),
  };
  const fullWidthPayrollPage = ['/hr/payroll-batches', '/hr/payroll-disbursement'].includes(location.pathname) || /^\/hr\/payroll-records\/\d+\/\d{4}-\d{2}$/.test(location.pathname);
  const noOuterCardPage = ['/hr/onboarding', '/hr/employees'].includes(location.pathname);
  return <div className={fullWidthPayrollPage ? 'payroll-batches-page' : noOuterCardPage ? undefined : 'page-stack'}>
    {!fullWidthPayrollPage && !noOuterCardPage && location.pathname !== '/hr/payroll-records' && <PageTitle title={subModuleLabel(location.pathname) ?? '人事管理'} />}
    {fullWidthPayrollPage || noOuterCardPage ? <Outlet context={context} /> : <Card className="panel-card" bordered={false}><Outlet context={context} /></Card>}
  </div>;
}

export function HrOnboardingPage() {
  const { markArchiveChanged } = useOutletContext<HrLayoutContext>();
  return <OnboardingForms onArchived={markArchiveChanged} />;
}

export function HrEmployeesPage() {
  const { employees, archiveRevision, refreshEmployees } = useOutletContext<HrLayoutContext>();
  return <EmployeeRecords employees={employees} archiveRevision={archiveRevision} refreshEmployees={refreshEmployees} />;
}

export function HrPayrollBatchesPage() {
  const { employees } = useOutletContext<HrLayoutContext>();
  return <HrPayrollBatches employees={employees} />;
}

export function HrPayrollDisbursementPage() {
  return <HrPayrollDisbursement />;
}

export function HrPayrollRecordsPage() {
  return <HrPayrollRecords />;
}

export function HrPayrollRecordDetailPage() {
  return <PayrollRecordDetail />;
}

export function HrOffboardingPage() {
  const { employees, refreshEmployees } = useOutletContext<HrLayoutContext>();
  return <HrOffboarding employees={employees} onEmployeeChanged={refreshEmployees} />;
}
