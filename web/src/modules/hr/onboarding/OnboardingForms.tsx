import { useEffect, useState } from 'react';
import { App, Button, Card, DatePicker, Empty, Form, Modal, Select, Space, Spin, Table, Tag, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { request } from '../../../api/client';
import { getOnboardingRecords, type OnboardingRecord } from '../api';
import { ONBOARDING_FORM_URL, type Field } from './api';

type Candidate = { id: string; name: string; employeeNo: string; loginName: string };
type AnswerValue = string | number | Record<string, string | number>[];
type AnswerValues = Record<string, AnswerValue>;
type Application = { id: number; name: string; employeeNo: string; loginName: string; expectedDate: string; createdAt: string; submittedAt: string | null; archivedAt: string | null; template: Field[]; answers: AnswerValues | null; photo?: string | null; signature?: string | null; declaration?: string | null; declarationAccepted?: boolean | null };
type Change =
  | { kind: 'field'; field: string; before?: string | number; after?: string | number }
  | { kind: 'cell'; field: string; row: number; child: string; before?: string | number; after?: string | number }
  | { kind: 'addRow'; field: string; row: number; after: Record<string, string | number> }
  | { kind: 'removeRow'; field: string; row: number; before: Record<string, string | number> };
type SubmissionEntry = { id: number; template: Field[]; answers: AnswerValues | { __onboardingFormat: number; values: AnswerValues; photo?: string; signature?: string; declaration?: string; declarationAccepted?: boolean }; submittedAt: string; returnedAt: string; adminName: string };
type ApplicationHistoryEntry = { id: number; onboardingId: number; before: AnswerValues; after: AnswerValues; changes: Change[]; adminName: string; createdAt: string };

const displayValue = (value: unknown): string => value === undefined || value === null || value === '' ? '未填写' : String(value);
const formatChange = (change: Change): string => {
  if (change.kind === 'field') return `${change.field}：${displayValue(change.before)} → ${displayValue(change.after)}`;
  if (change.kind === 'cell') return `${change.field} 第${change.row}行 · ${change.child}：${displayValue(change.before)} → ${displayValue(change.after)}`;
  if (change.kind === 'addRow') {
    const values = Object.entries(change.after).map(([key, value]) => `${key}=${displayValue(value)}`).join('，');
    return `${change.field} 第${change.row}行：新增${values ? `（${values}）` : ''}`;
  }
  const values = Object.entries(change.before).map(([key, value]) => `${key}=${displayValue(value)}`).join('，');
  return `${change.field} 第${change.row}行：删除${values ? `（${values}）` : ''}`;
};

export function OnboardingForms({ onArchived }: { onArchived?: () => void }) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<Application[]>([]);
  const [legacy, setLegacy] = useState<OnboardingRecord[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [register, setRegister] = useState(false);
  const [detail, setDetail] = useState<Application>();
  const [saving, setSaving] = useState(false);
  const [historyApplication, setHistoryApplication] = useState<Application>();
  const [applicationHistory, setApplicationHistory] = useState<ApplicationHistoryEntry[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>([]);
  const [applicationHistoryLoading, setApplicationHistoryLoading] = useState(false);
  const [form] = Form.useForm<{ employeeId: string; expectedDate: Dayjs }>();
  const load = async () => {
    try {
      const [r, c, old] = await Promise.all([request<Application[]>(`${ONBOARDING_FORM_URL}/applications`), request<Candidate[]>(`${ONBOARDING_FORM_URL}/eligible`), getOnboardingRecords()]);
      setRows(r); setCandidates(c); setLegacy(old);
      return r;
    } catch (error) { message.error((error as Error).message); return rows; }
  };
  useEffect(() => { void load(); }, []);
  const submit = async (values: { employeeId: string; expectedDate: Dayjs }) => {
    setSaving(true); try { await request(`${ONBOARDING_FORM_URL}/applications`, { method: 'POST', body: { employeeId: values.employeeId, expectedDate: values.expectedDate.format('YYYY-MM-DD') } }); setRegister(false); form.resetFields(); await load(); message.success('申请已登记，员工登录后可填写'); }
    catch (error) { message.error((error as Error).message); } finally { setSaving(false); }
  };
  const returnApplication = (application: Application) => {
    modal.confirm({
      title: '打回入职申请？',
      content: '员工将重新填写并确认声明；本次提交内容及签名会保存在填写历史中。',
      okText: '打回重填', cancelText: '取消',
      onOk: async () => {
        try { await request(`${ONBOARDING_FORM_URL}/applications/${application.id}/return`, { method: 'POST', body: {} }); setDetail(undefined); await load(); message.success('已打回，员工可重新填写'); }
        catch (error) { message.error((error as Error).message); throw error; }
      },
    });
  };
  const archiveApplication = (application: Application) => {
    modal.confirm({
      title: '封存入职申请？',
      content: '封存后申请将作为员工档案只读保存，不能再打回或修改。',
      okText: '确认封存', cancelText: '取消',
      onOk: async () => {
        try { await request(`${ONBOARDING_FORM_URL}/applications/${application.id}/archive`, { method: 'POST', body: {} }); onArchived?.(); setDetail(undefined); await load(); message.success('申请已封存'); }
        catch (error) { message.error((error as Error).message); throw error; }
      },
    });
  };
  const loadApplicationHistory = async (application: Application) => {
    setHistoryApplication(application); setApplicationHistory([]); setSubmissions([]); setApplicationHistoryLoading(true);
    try { const [edits, prior] = await Promise.all([request<ApplicationHistoryEntry[]>(`${ONBOARDING_FORM_URL}/applications/${application.id}/history`), request<SubmissionEntry[]>(`${ONBOARDING_FORM_URL}/applications/${application.id}/submissions`)]); setApplicationHistory(edits); setSubmissions(prior); }
    catch (error) { message.error((error as Error).message); }
    finally { setApplicationHistoryLoading(false); }
  };
  return <div className="page-stack">
    <Card title="入职申请" extra={<Button type="primary" onClick={() => { form.resetFields(); setRegister(true); }}>登记申请</Button>}>
      <Table rowKey="id" dataSource={rows} scroll={{ x: 800 }} columns={[
        { title: '申请编号', dataIndex: 'id' }, { title: '员工', render: (_, r) => `${r.name} · ${r.employeeNo}` }, { title: '员工账号', dataIndex: 'loginName' },
        { title: '预计入职日期', dataIndex: 'expectedDate' }, { title: '填写状态', render: (_, r) => <Tag color={r.archivedAt ? 'blue' : r.submittedAt ? 'green' : 'orange'}>{r.archivedAt ? '已封存' : r.submittedAt ? '已提交' : '待填写'}</Tag> },
        { title: '登记时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
        { title: '操作', render: (_, r) => <Button type="link" onClick={() => setDetail(r)}>查看详情</Button> },
      ]} />
    </Card>
    {legacy.length > 0 && <Card title="历史入职申请"><Table rowKey="id" dataSource={legacy} pagination={{ pageSize: 10 }} columns={[
      { title: '申请编号', dataIndex: 'id' }, { title: '申请内容', render: (_, r) => Object.entries(r.fields).map(([k, v]) => `${k}：${v}`).join(' · ') },
      { title: '员工档案', render: (_, r) => r.employeeId || '未建档' }, { title: '登记时间', dataIndex: 'createdAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    ]} /></Card>}
    <Modal title="登记入职申请" open={register} onCancel={() => setRegister(false)} onOk={() => form.submit()} confirmLoading={saving} okText="登记" destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={submit}><Form.Item name="employeeId" label="员工账号" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" placeholder="选择未登记的员工账号" options={candidates.map(c => ({ value: c.id, label: `${c.name} · ${c.employeeNo} · ${c.loginName}` }))} /></Form.Item><Form.Item name="expectedDate" label="预计入职日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Form>
    </Modal>
    <Modal title={detail ? `入职申请详情 · ${detail.name}` : '入职申请详情'} open={!!detail} onCancel={() => setDetail(undefined)} width={760} destroyOnHidden styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}
      footer={detail ? <div className="onboarding-modal-footer">
        <Space>
          <Tooltip title={detail.archivedAt ? '申请已封存，不能打回' : detail.submittedAt ? undefined : '员工尚未提交，不能打回'}><span><Button disabled={!detail.submittedAt || !!detail.archivedAt} onClick={() => returnApplication(detail)}>打回重填</Button></span></Tooltip>
          <Button onClick={() => void loadApplicationHistory(detail)}>填写历史</Button>
          <Tooltip title={detail.archivedAt ? '申请已封存' : detail.submittedAt ? undefined : '员工尚未提交，不能封存'}><span><Button type="primary" disabled={!detail.submittedAt || !!detail.archivedAt} onClick={() => archiveApplication(detail)}>封存</Button></span></Tooltip>
        </Space>
        <Button onClick={() => setDetail(undefined)}>关闭</Button>
      </div> : null}>
      {detail && !detail.submittedAt && detail.answers && <Tag color="orange" style={{ marginBottom: 16 }}>已打回，等待员工重新提交；可在填写历史中查看上次提交内容</Tag>}
      {detail && (detail.submittedAt && detail.answers ? detail.template.map(f => { const value = detail.answers?.[f.name]; return <div key={f.name} style={{ marginBottom: 12 }}><b>{f.name}：</b>{Array.isArray(value) ? value.length ? <Table size="small" rowKey={(_, i) => String(i)} dataSource={value} pagination={false} scroll={{ x: true }} columns={(f.children || []).map(child => ({ title: child.name, dataIndex: child.name, render: (item: string | number | undefined) => item ?? '—' }))} /> : '未填写' : value ?? '未填写'}</div>; }) : <Typography.Text type="secondary">员工尚未提交入职信息。</Typography.Text>)}
      {detail?.submittedAt && detail.answers && <Space direction="vertical"><div><b>照片：</b>{detail.photo ? <img src={detail.photo} alt="员工照片" style={{ maxWidth: 150, maxHeight: 150, verticalAlign: 'top' }} /> : '未填写'}</div><div><b>签名：</b>{detail.signature ? <img src={detail.signature} alt="员工手写签名" style={{ maxWidth: 280, maxHeight: 150, verticalAlign: 'top', border: '1px solid #eee' }} /> : '未填写'}</div></Space>}
      {detail?.submittedAt && detail.declaration && <div style={{ marginTop: 16 }}><b>声明：</b><p>{detail.declaration}</p><p>{detail.declarationAccepted ? '员工已勾选确认' : '员工未勾选确认'}</p></div>}
    </Modal>
    <Modal title={historyApplication ? `填写历史 · ${historyApplication.name}` : '填写历史'} open={!!historyApplication} onCancel={() => setHistoryApplication(undefined)} footer={<Button onClick={() => setHistoryApplication(undefined)}>关闭</Button>} width={760} styles={{ body: { maxHeight: '68vh', overflowY: 'auto' } }}>
      <Spin spinning={applicationHistoryLoading}>
        {applicationHistory.length === 0 && submissions.length === 0 ? <Empty description="暂无历史记录" /> : <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {submissions.map(entry => {
            const payload = entry.answers as { __onboardingFormat?: number; values?: AnswerValues; photo?: string; signature?: string; declaration?: string; declarationAccepted?: boolean };
            const values = payload.__onboardingFormat === 2 ? payload.values ?? {} : entry.answers as AnswerValues;
            return <Card key={`submission-${entry.id}`} size="small" title={`提交于 ${dayjs(entry.submittedAt).format('YYYY-MM-DD HH:mm:ss')}`} extra={<Typography.Text type="secondary">{entry.adminName} · {dayjs(entry.returnedAt).format('YYYY-MM-DD HH:mm:ss')} 打回</Typography.Text>}>
              {entry.template.map(field => { const value = values[field.name]; return <div key={field.name} style={{ marginBottom: 8 }}><b>{field.name}：</b>{Array.isArray(value) ? value.length ? <Table size="small" rowKey={(_, index) => String(index)} dataSource={value} pagination={false} scroll={{ x: true }} columns={(field.children || []).map(child => ({ title: child.name, dataIndex: child.name, render: (item: string | number | undefined) => item ?? '—' }))} /> : '未填写' : value ?? '未填写'}</div>; })}
              {payload.__onboardingFormat === 2 && <Space direction="vertical"><div><b>照片：</b>{payload.photo ? <img src={payload.photo} alt="历史员工照片" style={{ maxWidth: 150, maxHeight: 150, verticalAlign: 'top' }} /> : '未填写'}</div><div><b>签名：</b>{payload.signature ? <img src={payload.signature} alt="历史员工签名" style={{ maxWidth: 280, maxHeight: 150, verticalAlign: 'top' }} /> : '未填写'}</div>{payload.declaration && <div><b>声明：</b><p>{payload.declaration}</p><p>{payload.declarationAccepted ? '员工已勾选确认' : '员工未勾选确认'}</p></div>}</Space>}
            </Card>;
          })}
          {applicationHistory.map(entry => <Card key={entry.id} size="small" title={`旧版管理员修改 · ${dayjs(entry.createdAt).format('YYYY-MM-DD HH:mm:ss')}`} extra={<Typography.Text type="secondary">{entry.adminName}</Typography.Text>}>
            {entry.changes.length === 0 ? <Typography.Text type="secondary">字段内容有调整</Typography.Text> : <Space direction="vertical" size={4}>{entry.changes.map((change, index) => <div className="onboarding-history-change" key={index}>{formatChange(change)}</div>)}</Space>}
          </Card>)}
        </Space>}
      </Spin>
    </Modal>
  </div>;
}
