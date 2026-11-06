import { useEffect, useState } from 'react';
import { App, Table } from 'antd';
import dayjs from 'dayjs';
import { SubModuleHeader } from '../../../components/SubModuleHeader';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';
import { getPayrollRecords, type PayrollRecord } from '../api';

export function HrPayrollDisbursement() {
  return <SubModuleHeader title="工资发放" />;
}

export function HrPayrollRecords() {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [rows, setRows] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    setLoading(true);
    getPayrollRecords().then(records => { if (active) setRows(records); }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceActive]);
  return <>
    <SubModuleHeader title="工资发放记录" />
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} columns={[
      { title: '类型', render: (_: unknown, r: PayrollRecord) => r.batchId == null ? '员工' : '工资批次' },
      { title: '员工', render: (_: unknown, r: PayrollRecord) => `${r.name} · ${r.employeeNo}` },
      { title: '工资月份', dataIndex: 'month' }, { title: '实发金额', dataIndex: 'amount', render: (n: string) => `¥${Number(n).toFixed(2)}` },
      { title: '备注', dataIndex: 'note', render: (v: string) => v || '—' }, { title: '登记时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    ]} />
  </>;
}
