import { useEffect, useRef, useState } from 'react';
import { App, Button, Descriptions, Input, Modal, Pagination, Space, Table, Typography } from 'antd';
import { getDisbursement, saveDisbursementValue, type DisbursementState, type PayrollBatch, type PayrollBatchItem, type SalaryComponentModel } from '../api';
import { ApiError } from '../../../api/client';
import { payrollFieldNames } from './payrollFieldOrder';

const money = (value: number | null | undefined) => value == null ? '—' : `¥${Number(value).toFixed(2)}`;

type CellEdit = { itemId: number; fieldId: number; value: string; revision: number; original: number; error?: string; conflict?: boolean };

export function PayrollDisbursementBatch({ batch, items, model, disbursement, onChange, onEditingChange }: { batch: PayrollBatch; items: PayrollBatchItem[]; model: SalaryComponentModel; disbursement: DisbursementState; onChange: (data: DisbursementState) => void; onEditingChange: (busy: boolean) => void }) {
  const { message } = App.useApp();
  const [page, setPage] = useState(1);
  const [legacyItem, setLegacyItem] = useState<PayrollBatchItem>();
  const [edit, setEdit] = useState<CellEdit>();
  const [saving, setSaving] = useState(false);
  const editRef = useRef<CellEdit>();
  const savingRef = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(items.length / 10)));
  const pageItems = items.slice((currentPage - 1) * 10, currentPage * 10);
  const fieldNames = payrollFieldNames(model, items.map(item => item.modelSnapshot));
  const updateEdit = (value?: CellEdit) => { editRef.current = value; setEdit(value); onEditingChange(!!value); };
  const saveEdit = async (explicit: boolean) => {
    const current = editRef.current;
    if (!current || savingRef.current || (current.error && !explicit)) return;
    const raw = current.value.trim();
    const number = Number(raw);
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(number) || number > 9999999999.99) {
      updateEdit({ ...current, error: '请输入非负数字，最多两位小数' }); return;
    }
    if (!current.conflict && number === current.original) { updateEdit(); return; }
    savingRef.current = true; setSaving(true);
    try {
      onChange(await saveDisbursementValue(batch.id, current.itemId, current.fieldId, number, current.revision));
      updateEdit();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await getDisbursement(batch.id);
          const value = latest.rows.find(row => row.itemId === current.itemId)?.values.find(field => field.fieldId === current.fieldId);
          onChange(latest);
          updateEdit({ ...current, revision: value?.revision ?? current.revision, original: value?.value ?? current.original, conflict: true, error: '已加载最新值，请核对后按回车保存' });
        } catch { updateEdit({ ...current, error: '刷新失败，请按回车重试' }); }
      } else updateEdit({ ...current, error: (error as Error).message || '保存失败，请重试' });
      message.error((error as Error).message || '保存失败，请重试');
    } finally { savingRef.current = false; setSaving(false); }
  };

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
    ...disbursement.fields.map(field => ({ title: field.name, key: `supplement-${field.id}`, width: 120, render: (_: unknown, row: PayrollBatchItem) => {
      const entry = disbursement.rows.find(item => item.itemId === row.id)?.values.find(item => item.fieldId === field.id);
      const value = entry?.value ?? 0;
      if (edit?.itemId === row.id && edit.fieldId === field.id) return <Input autoFocus size="small" className="payroll-cell-input" aria-label={`编辑${row.name}的${field.name}`} aria-invalid={!!edit.error} aria-busy={saving} title={edit.error} status={edit.error ? 'error' : undefined} value={edit.value} disabled={saving} inputMode="decimal" onChange={event => { const current = editRef.current; if (current) updateEdit({ ...current, value: event.target.value, error: current.conflict ? current.error : undefined }); }} onBlur={() => void saveEdit(false)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveEdit(true); } else if (event.key === 'Escape' && !savingRef.current) { event.preventDefault(); updateEdit(); } }} />;
      return <button type="button" className="payroll-cell-edit" aria-label={`编辑${row.name}的${field.name}`} disabled={!!edit || saving} onClick={() => updateEdit({ itemId: row.id, fieldId: field.id, value: String(value), original: value, revision: entry?.revision ?? 0 })}>{Number(value).toFixed(2)}</button>;
    } })),
    { title: '实发', key: 'actual-net', width: 120, render: (_: unknown, row: PayrollBatchItem) => money(disbursement.rows.find(item => item.itemId === row.id)?.net ?? Number(row.gross)) },
    { title: '操作', key: 'actions', width: 180, fixed: 'right' as const, render: (_: unknown, row: PayrollBatchItem) => !row.modelSnapshot && <Button type="link" onClick={() => setLegacyItem(row)}>查看原明细</Button> },
  ];

  return <div className="payroll-batches-content">
    <div className="payroll-batches-current"><Typography.Text strong>{batch.month} · 已复核</Typography.Text></div>
    <div className="payroll-batches-grid-stage">
      <div ref={tableRef} className="payroll-batches-table"><Table rowKey="id" dataSource={pageItems} pagination={false} scroll={{ x: 'max-content' }} columns={columns} /></div>
      <div ref={bottomRef} className="payroll-batches-bottom">
        {items.length > 0 && <Pagination size="small" current={currentPage} total={items.length} pageSize={10} showSizeChanger={false} onChange={setPage} />}
        <div className="payroll-batches-footer">{items.length > 0 && <Space wrap><Typography.Text strong>本批次合计：</Typography.Text><Typography.Text strong>应发 {money(items.reduce((sum, item) => sum + Number(item.gross), 0))}</Typography.Text><Typography.Text strong>实发 {money(disbursement.rows.reduce((sum, item) => sum + Math.round(item.net * 100), 0) / 100)}</Typography.Text></Space>}</div>
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
