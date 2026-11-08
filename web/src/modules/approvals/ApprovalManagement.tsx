import { Card } from 'antd';
import { Navigate, useParams } from 'react-router-dom';

import { SubModuleHeader } from '../../components/SubModuleHeader';
import { ExpenseApproverSettings } from './ExpenseApproverSettings';
import { ExpenseRulesSettings } from './ExpenseRulesSettings';

const APPROVAL_TYPES = [
  { key: 'leave', label: '请假审批' },
  { key: 'expense', label: '报销审批' },
  { key: 'overtime', label: '加班审批' },
  { key: 'travel', label: '出差审批' },
  { key: 'purchase', label: '采购审批' },
] as const;

export function ApprovalManagementPage() {
  const { type } = useParams();
  const selected = APPROVAL_TYPES.find((item) => item.key === type);

  if (!selected) return <Navigate to="/approvals/leave" replace />;

  return (
    <div className="page-stack">
      <SubModuleHeader title={selected.label} />
      {selected.key === 'expense' ? (
        <div className="expense-function-stack">
          <Card title="发票审批人" className="panel-card expense-function-card" bordered={false}>
            <ExpenseApproverSettings />
          </Card>
          <Card title="审批规则" className="panel-card expense-function-card" bordered={false}>
            <ExpenseRulesSettings />
          </Card>
        </div>
      ) : (
        <Card title={`${selected.label}人`} className="panel-card expense-function-card" bordered={false}>
          <ExpenseApproverSettings key={selected.key} type={selected.key} label={`${selected.label}人`} />
        </Card>
      )}
    </div>
  );
}
