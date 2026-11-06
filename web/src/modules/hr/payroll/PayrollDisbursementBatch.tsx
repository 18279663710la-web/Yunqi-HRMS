import { useEffect, useRef, useState } from 'react';
import { Button, Descriptions, Modal, Pagination, Space, Table, Typography } from 'antd';
import type { PayrollBatch, PayrollBatchItem, SalaryComponentModel } from '../api';
import { payrollFieldNames } from './payrollFieldOrder';

const money = (value: number | null | undefined) => value == null ? '—' : `¥${Number(value).toFixed(2)}`;

export function PayrollDisbursementBatch({ batch, items, model }: { batch: PayrollBatch; items: PayrollBatchItem[]; model: SalaryComponentModel }) {
  const [page, setPage] = useState(1);
  const [legacyItem, setLegacyItem] = useState<PayrollBatchItem>();
  const tableRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / 10)));
  const pageItems = items.slice((currentPage - 1) * 10, currentPage * 10);
  const fieldNames = payrollFieldNames(model, items.map(item => item.modelSnapshot));

  useEffect(() => { setPage(1); setLegacyItem(undefined); }, [batch.id]);
  useEffect(() => {
    const scroll = tableRef.current?.querySelector<HTMLElement>('.ant-table-content');
    const bottom = bottomRef.current;
    if (!scroll || !bottom) return;
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', '工资明细表格滚动');
    const resize = () => { scroll.style.paddingBottom = `${Math.ceil(bottom.getBoundingClientRect().height) + 28}px`; };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, [batch.id]);

  const columns = [
    ...fieldNames.map((name, index) => {
      if (name === '姓名') return { title: name, key: name, dataIndex: 'name', width: 100, ...(index === 0 ? { fixed: 'left' as const } : {}) };
      if (name === '员工号') return { title: name, key: name, dataIndex: 'employeeNo', width: 110 };
      if (name === '职务') return { title: name, key: name, width: 120, render: (_: unknown, row: PayrollBatchItem) => row.modelSnapshot?.position ?? row.position ?? '—' };
      return { title: name, key: name, width: 120, render: (_: unknown, row: PayrollBatchItem) => {
        const field = [...(row.modelSnapshot?.fixed ?? []), ...(row.modelSnapshot?.extended ?? [])].find(item => item.name === name);
        if (!field) return '—';
        return typeof field.value === 'number' ? field.value.toFixed(2) : field.value || '—';
      } };
    }),
    { title: '应发', dataIndex: 'gross', width: 120, render: (value: number) => money(value) },
    { title: '操作', key: 'actions', width: 180, fixed: 'right' as const, render: (_: unknown, row: PayrollBatchItem) => !row.modelSnapshot && <Button type="link" onClick={() => setLegacyItem(row)}>查看原明细</Button> },
  ];

  return <div className="payroll-batches-content">
    <div className="payroll-batches-current"><Typography.Text strong>{batch.month} · 已复核</Typography.Text></div>
    <div className="payroll-batches-grid-stage">
      <div ref={tableRef} className="payroll-batches-table"><Table rowKey="id" dataSource={pageItems} pagination={false} scroll={{ x: 'max-content' }} columns={columns} /></div>
      <div ref={bottomRef} className="payroll-batches-bottom">
        {items.length > 0 && <Pagination size="small" current={currentPage} total={items.length} pageSize={10} showSizeChanger={false} onChange={setPage} />}
        <div className="payroll-batches-footer">{items.length > 0 && <Space wrap><Typography.Text strong>本批次合计：</Typography.Text><Typography.Text strong>应发 {money(items.reduce((sum, item) => sum + Number(item.gross), 0))}</Typography.Text></Space>}</div>
      </div>
    </div>
    <Modal title={`原工资明细 · ${legacyItem?.name ?? ''}`} open={!!legacyItem} onCancel={() => setLegacyItem(undefined)} footer={<Button onClick={() => setLegacyItem(undefined)}>关闭</Button>}>
      {legacyItem && <Descriptions column={1} size="small" items={[
        { key: 'base', label: '应发（调整前）', children: money(legacyItem.baseGross) },
        { key: 'rate', label: '出勤率', children: legacyItem.attendanceRate == null ? '—' : `${Number(legacyItem.attendanceRate).toFixed(2)}%` },
        { key: 'adjustment', label: '绩效调整', children: money(legacyItem.attendanceAdjustment) },
        { key: 'time', label: '加班时长', children: `${Number(legacyItem.overtimeSeconds)} 秒` },
        { key: 'overtime', label: '加班绩效', children: money(legacyItem.overtimePay) },
        { key: 'gross', label: '应发', children: money(legacyItem.gross) },
        { key: 'note', label: '说明', children: legacyItem.note || '—' },
      ]} />}
    </Modal>
  </div>;
}
