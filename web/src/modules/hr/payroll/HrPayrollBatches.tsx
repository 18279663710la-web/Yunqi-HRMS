import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { App, Button, DatePicker, Descriptions, Dropdown, Form, Input, Modal, Pagination, Popconfirm, Select, Space, Table, Typography } from 'antd';
import { type Dayjs } from 'dayjs';
import { addAutoPayrollItems, addPayrollBatchItem, createPayrollBatch, deletePayrollBatch, getPayrollBatches, getPayrollBatchItems, getPayrollEmployeeAvailability, getSalaryComponentModel, previewAutoPayrollItems, removePayrollBatchItem, reviewPayrollBatch, updatePayrollExtended, updatePayrollFixed, type AutoPayrollPreview, type HrEmployee, type PayrollBatch, type PayrollBatchItem, type PayrollModelSnapshot, type SalaryComponentModel } from '../api';
import { ApiError } from '../../../api/client';
import { getPayrollPage } from './payrollPagination';
import { payrollFieldNames } from './payrollFieldOrder';
import { buildPayrollExportData } from './payrollExportData';
import { buildInlinePayrollUpdate, buildFixedPayrollUpdate, previewInlinePayrollTotals } from './payrollInlineEdit';
import { useWorkspaceActive } from '../../../layout/WorkspaceContext';

const money = (value: number | null | undefined) => value == null ? '—' : `¥${Number(value).toFixed(2)}`;
type CellEdit = { batchId: number; itemId: number; fieldName: string; fixed?: boolean; value: string; snapshot: PayrollModelSnapshot; error?: string; conflict?: boolean; latestSnapshot?: PayrollModelSnapshot };

export function HrPayrollBatches({ employees }: { employees: HrEmployee[] }) {
  const { message } = App.useApp();
  const workspaceActive = useWorkspaceActive();
  const [batches, setBatches] = useState<PayrollBatch[]>([]);
  const [selected, setSelected] = useState<number>();
  const [items, setItems] = useState<PayrollBatchItem[]>([]);
  const [page, setPage] = useState(1);
  const [model, setModel] = useState<SalaryComponentModel>();
  const [loading, setLoading] = useState(false);
  const [month, setMonth] = useState<Dayjs | null>(null);
  const [open, setOpen] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [reviewedEmployeeIds, setReviewedEmployeeIds] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoPreview, setAutoPreview] = useState<AutoPayrollPreview>();
  const [autoLoading, setAutoLoading] = useState(false);
  const [cellEdit, setCellEdit] = useState<CellEdit>();
  const [cellSaving, setCellSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [legacyItem, setLegacyItem] = useState<PayrollBatchItem>();
  const [form] = Form.useForm<{ employeeId: string }>();
  const cellEditRef = useRef<CellEdit>();
  const cellSavingRef = useRef(false);
  const exportingRef = useRef(false);
  const nextCellRef = useRef<{ batchId: number; itemId: number; fieldName: string; fixed?: boolean }>();
  const itemsRef = useRef<PayrollBatchItem[]>([]);
  const itemsEpoch = useRef(0);
  const selectedRef = useRef<number>();
  const previousBatch = useRef<number>();
  const tableRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const current = batches.find(item => item.id === selected);
  selectedRef.current = selected;
  const pageData = getPayrollPage(items, page, 10);
  const loadBatches = async () => { setBatches(await getPayrollBatches()); };
  const replaceItems = (rows: PayrollBatchItem[]) => { itemsRef.current = rows; setItems(rows); };
  const updateEdit = (edit?: CellEdit) => { cellEditRef.current = edit; setCellEdit(edit); };
  const openNextCell = () => {
    const next = nextCellRef.current; nextCellRef.current = undefined;
    if (!next || selectedRef.current !== next.batchId) return;
    const row = itemsRef.current.find(item => item.id === next.itemId);
    const field = (next.fixed ? row?.modelSnapshot?.fixed : row?.modelSnapshot?.extended)?.find(item => item.name === next.fieldName);
    if (row?.modelSnapshot && field && (next.fixed || !field.attendanceMetric)) updateEdit({ ...next, value: String(field.value), snapshot: row.modelSnapshot });
  };
  const loadItems = async (id: number) => { const epoch = itemsEpoch.current; const rows = await getPayrollBatchItems(id); if (selectedRef.current === id && epoch === itemsEpoch.current) replaceItems(rows); };
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    getPayrollBatches().then(rows => { if (active) setBatches(rows); }).catch((error: Error) => { if (active) message.error(error.message); });
    getSalaryComponentModel().then(result => { if (active) setModel(result); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [workspaceActive]);
  useEffect(() => {
    if (!workspaceActive) return;
    let active = true;
    if (previousBatch.current !== selected) { previousBatch.current = selected; itemsEpoch.current++; replaceItems([]); }
    const epoch = itemsEpoch.current;
    if (selected) getPayrollBatchItems(selected).then(rows => { if (active && epoch === itemsEpoch.current && selectedRef.current === selected) replaceItems(rows); }).catch((error: Error) => { if (active) message.error(error.message); });
    return () => { active = false; };
  }, [selected, workspaceActive]);
  useEffect(() => { setPage(1); }, [selected]);
  useEffect(() => { if (page !== pageData.page) setPage(pageData.page); }, [page, pageData.page]);
  useLayoutEffect(() => {
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
  }, [selected, current?.status, workspaceActive]);
  const create = async () => {
    if (cellEditRef.current || cellSavingRef.current) return;
    if (!month) { message.warning('请选择工资月份'); return; }
    setLoading(true);
    try { const result = await createPayrollBatch(month.format('YYYY-MM')); await loadBatches(); setSelected(result.id); message.success('工资批次已创建'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const openAdd = async () => {
    if (!selected || availabilityLoading) return;
    setAvailabilityLoading(true);
    try {
      const availability = await getPayrollEmployeeAvailability(selected);
      if (selectedRef.current !== selected) return;
      setReviewedEmployeeIds(availability.reviewedEmployeeIds);
      form.resetFields();
      setOpen(true);
    } catch (error) { message.error((error as Error).message); }
    finally { setAvailabilityLoading(false); }
  };
  const add = async (values: { employeeId: string }) => {
    if (!selected || cellEditRef.current || cellSavingRef.current) return; setLoading(true);
    try { await addPayrollBatchItem(selected, values); setOpen(false); form.resetFields(); await loadItems(selected); message.success('工资明细已添加'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const openAutoPreview = async () => {
    if (!selected || current?.status !== 'draft' || cellEditRef.current || cellSavingRef.current) return;
    setAutoLoading(true);
    try {
      const preview = await previewAutoPayrollItems(selected);
      if (!preview.candidates.length) { message.info(preview.existingCount || preview.reviewedCount ? `没有可添加的员工，本批次已有 ${preview.existingCount} 人，本月已复核 ${preview.reviewedCount} 人` : '没有同时满足封存入职表、劳动合同和定薪条件的员工'); return; }
      setOpen(false); setAutoPreview(preview); setAutoOpen(true);
    } catch (error) { message.error((error as Error).message); } finally { setAutoLoading(false); }
  };
  const confirmAuto = async () => {
    if (!selected || cellEditRef.current || cellSavingRef.current) return; setLoading(true);
    try { const result = await addAutoPayrollItems(selected); setAutoOpen(false); setAutoPreview(undefined); await loadItems(selected); message.success(`已添加 ${result.addedCount} 人${result.skippedExisting ? `；跳过 ${result.skippedExisting} 人` : ''}`); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const saveCell = async (explicit: boolean) => {
    const edit = cellEditRef.current;
    if (!edit || cellSavingRef.current || edit.batchId !== selectedRef.current || (edit.conflict && !explicit) || (edit.error && !explicit)) return;
    if (edit.conflict && !edit.latestSnapshot) {
      cellSavingRef.current = true; setCellSaving(true); itemsEpoch.current++;
      try {
        const rows = await getPayrollBatchItems(edit.batchId);
        if (selectedRef.current !== edit.batchId || cellEditRef.current !== edit) return;
        itemsEpoch.current++; replaceItems(rows);
        const latestSnapshot = rows.find(row => row.id === edit.itemId)?.modelSnapshot;
        if (!latestSnapshot) throw new Error('工资明细已不存在');
        updateEdit({ ...edit, latestSnapshot, error: '已加载最新明细，请核对后按回车保存' });
      } catch (error) { updateEdit({ ...edit, error: (error as Error).message }); }
      finally { cellSavingRef.current = false; setCellSaving(false); }
      return;
    }
    const snapshot = edit.conflict ? edit.latestSnapshot! : edit.snapshot;
    let payload: ReturnType<typeof buildInlinePayrollUpdate> | undefined;
    let fixedPayload: ReturnType<typeof buildFixedPayrollUpdate> | undefined;
    try { if (edit.fixed) fixedPayload = buildFixedPayrollUpdate(snapshot, edit.fieldName, edit.value); else payload = buildInlinePayrollUpdate(snapshot, edit.fieldName, edit.value); }
    catch (error) { nextCellRef.current = undefined; const text = (error as Error).message; updateEdit({ ...edit, error: text }); message.error(text); return; }
    const previousValue = (edit.fixed ? snapshot.fixed : snapshot.extended).find(field => field.name === edit.fieldName)?.value;
    const nextValue = edit.fixed ? fixedPayload!.value : payload!.values.find(field => field.name === edit.fieldName)?.value;
    if (previousValue === nextValue) { updateEdit(); openNextCell(); return; }
    cellSavingRef.current = true; setCellSaving(true); itemsEpoch.current++;
    try {
      const result = edit.fixed ? await updatePayrollFixed(edit.batchId, edit.itemId, fixedPayload!) : await updatePayrollExtended(edit.batchId, edit.itemId, payload!);
      itemsEpoch.current++;
      if (selectedRef.current === edit.batchId) replaceItems(itemsRef.current.map(row => row.id === edit.itemId ? { ...row, ...result } : row));
      if (cellEditRef.current === edit) { updateEdit(); openNextCell(); }
    } catch (error) {
      nextCellRef.current = undefined;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const rows = await getPayrollBatchItems(edit.batchId);
          if (selectedRef.current !== edit.batchId || cellEditRef.current !== edit) return;
          itemsEpoch.current++; replaceItems(rows);
          const latestSnapshot = rows.find(row => row.id === edit.itemId)?.modelSnapshot;
          updateEdit({ ...edit, conflict: true, latestSnapshot: latestSnapshot ?? undefined, error: latestSnapshot ? '明细已被修改，请核对后按回车保存' : '工资明细已不存在' });
          message.error('工资明细已被其他操作修改，请核对后按回车保存');
        } catch { updateEdit({ ...edit, conflict: true, error: '刷新失败，请按回车重试' }); message.error('工资明细已被修改，刷新失败'); }
      } else {
        const text = (error as Error).message || '保存失败，请重试';
        updateEdit({ ...edit, error: text }); message.error(text);
      }
    } finally { cellSavingRef.current = false; setCellSaving(false); }
  };
  const remove = async (itemId: number) => {
    if (!selected || cellEditRef.current || cellSavingRef.current) return; setLoading(true);
    try { await removePayrollBatchItem(selected, itemId); await loadItems(selected); message.success('草稿明细已删除'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const removeDraft = async () => {
    if (!selected || cellEditRef.current || cellSavingRef.current) return; setLoading(true);
    try { await deletePayrollBatch(selected); setSelected(undefined); replaceItems([]); await loadBatches(); message.success('草稿批次已删除'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const review = async () => {
    if (!selected || cellEditRef.current || cellSavingRef.current) return; setLoading(true);
    try { await reviewPayrollBatch(selected); await Promise.all([loadBatches(), loadItems(selected)]); message.success('工资批次已复核'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const fieldNames = payrollFieldNames(model, items.map(item => item.modelSnapshot));
  const editingBusy = !!cellEdit || cellSaving || exporting;
  const exportBatch = async (format: 'pdf' | 'xlsx') => {
    if (!current || !items.length || !model || loading || cellEditRef.current || cellSavingRef.current || exportingRef.current) return;
    exportingRef.current = true; setExporting(true);
    try {
      const data = buildPayrollExportData(current, items, model);
      if (format === 'pdf') await (await import('./payrollExportPdf')).downloadPayrollPdf(data);
      else await (await import('./payrollExportXlsx')).downloadPayrollXlsx(data);
    } catch (error) { message.error((error as Error).message || '输出失败，请重试'); }
    finally { exportingRef.current = false; setExporting(false); }
  };
  const previewSnapshot = cellEdit?.conflict ? cellEdit.latestSnapshot : cellEdit?.snapshot;
  const preview = cellEdit && previewSnapshot ? previewInlinePayrollTotals(previewSnapshot, cellEdit.fieldName, cellEdit.value, false, cellEdit.fixed) : undefined;
  const previewRow = cellEdit && preview ? items.find(item => item.id === cellEdit.itemId) : undefined;
  const previewChanged = !!previewRow && !!preview && Number(previewRow.gross) !== preview.gross;
  const displayGross = (row: PayrollBatchItem) => previewChanged && row.id === cellEdit?.itemId ? preview!.gross : Number(row.gross);
  const previewMark = previewChanged ? <span title="未保存的实时预览" aria-label="未保存的实时预览">*</span> : null;
  const columns = [
    ...fieldNames.map((name, index) => {
      if (name === '姓名') return { title: name, key: name, dataIndex: 'name', width: 100, ...(index === 0 ? { fixed: 'left' as const } : {}) };
      if (name === '员工号') return { title: name, key: name, dataIndex: 'employeeNo', width: 110 };
      if (name === '职务') return { title: name, key: name, width: 120, render: (_: unknown, row: PayrollBatchItem) => row.modelSnapshot?.position ?? row.position ?? '—' };
      return { title: name, key: name, width: 120, render: (_: unknown, row: PayrollBatchItem) => {
      const field = [...(row.modelSnapshot?.fixed ?? []), ...(row.modelSnapshot?.extended ?? [])].find(item => item.name === name);
      if (!field) return '—';
      const fixed = row.modelSnapshot?.fixed.find(item => item.name === name);
      const extended = row.modelSnapshot?.extended.find(item => item.name === name);
      const editable = fixed ?? (extended && !extended.attendanceMetric ? extended : undefined);
      if (current?.status === 'draft' && editable) {
        if (cellEdit?.itemId === row.id && cellEdit.fieldName === name) return <Input
          autoFocus size="small" className="payroll-cell-input" aria-label={`编辑${row.name}的${name}`} aria-invalid={!!cellEdit.error} aria-busy={cellSaving} title={cellEdit.error}
          status={cellEdit.error ? 'error' : undefined} value={cellEdit.value} disabled={cellSaving} maxLength={editable.type === 'text' ? 200 : undefined} inputMode={editable.type === 'text' ? 'text' : 'decimal'}
          onChange={event => { const edit = cellEditRef.current; if (edit) updateEdit({ ...edit, value: event.target.value, error: edit.conflict ? edit.error : undefined }); }}
          onBlur={() => void saveCell(false)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveCell(true); } else if (event.key === 'Escape' && !cellSavingRef.current) { event.preventDefault(); nextCellRef.current = undefined; updateEdit(); } }}
        />;
        return <button type="button" className="payroll-cell-edit" aria-label={`编辑${row.name}的${name}`} title={fixed?.manualAdjustment ? `已手动调整，原值：${fixed.manualAdjustment.originalValue}` : undefined} disabled={loading || cellSaving || exporting} onMouseDown={event => { if (cellEditRef.current) event.preventDefault(); }} onClick={() => {
          if (cellSavingRef.current || !selected || !row.modelSnapshot) return;
          const edit = cellEditRef.current;
          if (edit) {
            if (edit.conflict) { message.warning('请核对当前修改并按回车保存，或按 Esc 取消'); return; }
            nextCellRef.current = { batchId: selected, itemId: row.id, fieldName: name, fixed: !!fixed }; void saveCell(true); return;
          }
          updateEdit({ batchId: selected, itemId: row.id, fieldName: name, fixed: !!fixed, value: String(editable.value), snapshot: row.modelSnapshot });
        }}>{typeof editable.value === 'number' ? editable.value.toFixed(2) : editable.value || '—'}</button>;
      }
      return typeof field.value === 'number' ? field.value.toFixed(2) : field.value || '—';
    } }; }),
    { title: '应发', dataIndex: 'gross', width: 120, render: (_: number, row: PayrollBatchItem) => <>{money(displayGross(row))}{previewChanged && row.id === cellEdit?.itemId && previewMark}</> },
    { title: '操作', key: 'actions', width: 180, fixed: 'right' as const, render: (_: unknown, row: PayrollBatchItem) => <Space>
      {!row.modelSnapshot && <Button type="link" onClick={() => setLegacyItem(row)}>查看原明细</Button>}
      {current?.status === 'draft' && <Popconfirm title="删除此草稿明细？" onConfirm={() => void remove(row.id)} okText="删除" cancelText="取消" disabled={editingBusy || loading}><Button type="link" danger disabled={editingBusy || loading}>删除</Button></Popconfirm>}
    </Space> },
  ];
  return <section className="payroll-batches-workspace" aria-label="工资批次">
    <div className="salary-model-entries payroll-batches-toolbar">
      <DatePicker picker="month" aria-label="新建工资月份" placeholder="选择月份" variant="borderless" value={month} onChange={setMonth} disabled={editingBusy} />
      <button type="button" className="salary-model-entry" onClick={() => void create()} disabled={loading || editingBusy}>创建批次</button>
      <button type="button" className="salary-model-entry" onClick={() => setHistoryOpen(true)} disabled={loading || editingBusy}>历史工资批次</button>
      <Popconfirm title="确认复核该批次？复核后不能修改。" onConfirm={() => void review()} okText="确认" cancelText="取消" disabled={loading || editingBusy || current?.status !== 'draft' || !items.length}><button type="button" className="salary-model-entry" disabled={loading || editingBusy || current?.status !== 'draft' || !items.length}>复核并锁定</button></Popconfirm>
      <Popconfirm title="删除该草稿及其全部工资明细？" onConfirm={() => void removeDraft()} okText="删除" cancelText="取消" disabled={loading || editingBusy || current?.status !== 'draft'}><button type="button" className="salary-model-entry salary-model-entry-danger" disabled={loading || editingBusy || current?.status !== 'draft'}>删除草稿</button></Popconfirm>
      <Dropdown trigger={['click']} disabled={loading || editingBusy || !current || !items.length || !model} menu={{ items: [{ key: 'pdf', label: 'PDF' }, { key: 'xlsx', label: 'XLSX' }], onClick: ({ key }) => void exportBatch(key as 'pdf' | 'xlsx') }}>
        <button type="button" className="salary-model-entry payroll-export-action" disabled={loading || editingBusy || !current || !items.length || !model}>输出</button>
      </Dropdown>
    </div>
    {current && <div className="payroll-batches-content">
      <div className="payroll-batches-current"><Typography.Text strong>{current.month} · 批次 #{current.id} · {current.status === 'draft' ? '草稿' : '已复核'}</Typography.Text></div>
      <div className="payroll-batches-grid-stage">
        <div ref={tableRef} className="payroll-batches-table"><Table rowKey="id" loading={loading} dataSource={pageData.items} pagination={false} scroll={{ x: 'max-content' }} columns={columns} /></div>
        <div ref={bottomRef} className="payroll-batches-bottom">
          {items.length > 0 && <Pagination size="small" current={pageData.page} total={items.length} pageSize={10} showSizeChanger={false} onChange={setPage} disabled={editingBusy} />}
          <div className="payroll-batches-footer">
            {current.status === 'draft' && <Button type="primary" size="small" disabled={editingBusy} loading={availabilityLoading} onClick={() => void openAdd()}>添加工资明细</Button>}
            {items.length > 0 && <Space wrap><Typography.Text strong>本批次合计：</Typography.Text><Typography.Text strong>应发 {money(items.reduce((sum, item) => sum + displayGross(item), 0))}{previewMark}</Typography.Text></Space>}
          </div>
        </div>
      </div>
    </div>}
    <Modal title="历史工资批次" open={historyOpen} onCancel={() => setHistoryOpen(false)} footer={<Button onClick={() => setHistoryOpen(false)}>关闭</Button>} width={600}>
      <Table rowKey="id" dataSource={batches} pagination={{ pageSize: 10 }} size="small" columns={[
        { title: '批次编号', dataIndex: 'id' },
        { title: '工资月份', dataIndex: 'month' },
        { title: '状态', render: (_: unknown, batch: PayrollBatch) => batch.status === 'draft' ? '草稿' : '已复核' },
        { title: '操作', render: (_: unknown, batch: PayrollBatch) => <Button type="link" onClick={() => { setSelected(batch.id); setHistoryOpen(false); }}>查看</Button> },
      ]} />
    </Modal>
    <Modal title="添加工资明细" open={open} onCancel={() => setOpen(false)} width={520} destroyOnHidden footer={<div style={{ display: 'flex', justifyContent: 'space-between' }}><Button onClick={() => void openAutoPreview()} loading={autoLoading}>一键添加</Button><Space><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" loading={loading} onClick={() => form.submit()}>确定</Button></Space></div>}>
      <Form form={form} layout="vertical" onFinish={add} preserve={false}><Form.Item label="员工" name="employeeId" rules={[{ required: true, message: '请选择员工' }]}><Select showSearch optionFilterProp="label" options={employees.map(employee => { const inBatch = items.some(item => item.employeeId === employee.id); const reviewed = reviewedEmployeeIds.includes(employee.id); return { value: employee.id, disabled: inBatch || reviewed, label: `${employee.name} · ${employee.employeeNo}${employee.employmentStatus === 'departed' ? ' · 已离职' : ''}${inBatch ? ' · 已在本批次' : reviewed ? ' · 本月已复核' : ''}` }; })} /></Form.Item></Form>
    </Modal>
    <Modal title={autoPreview ? `一键添加工资明细 · ${autoPreview.month}` : '一键添加工资明细'} open={autoOpen} onCancel={() => setAutoOpen(false)} width={900} footer={<Space><Button onClick={() => setAutoOpen(false)}>取消</Button><Button type="primary" loading={loading} onClick={() => void confirmAuto()}>确认添加 {autoPreview?.candidates.length ?? 0} 人</Button></Space>}>
      {autoPreview && <><Table rowKey="employeeId" dataSource={autoPreview.candidates} pagination={false} size="small" scroll={{ x: 'max-content', y: 360 }} columns={[
        ...payrollFieldNames(model, autoPreview.candidates.map(candidate => candidate.modelSnapshot)).map(name => {
          if (name === '姓名') return { title: name, key: name, dataIndex: 'name', width: 100 };
          if (name === '员工号') return { title: name, key: name, dataIndex: 'employeeNo', width: 100 };
          if (name === '职务') return { title: name, key: name, dataIndex: 'position', width: 120 };
          return { title: name, key: name, width: 120, render: (_: unknown, row: typeof autoPreview.candidates[number]) => { const value = [...row.modelSnapshot.fixed, ...row.modelSnapshot.extended].find(item => item.name === name)?.value; return typeof value === 'number' ? value.toFixed(2) : value || '—'; } };
        }),
        { title: '固定薪资合计', dataIndex: 'baseGross', width: 130, render: (value: number) => money(value) },
      ]} /><Typography.Text strong>合计：{money(autoPreview.totals.baseGross)}</Typography.Text></>}
    </Modal>
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
  </section>;
}
