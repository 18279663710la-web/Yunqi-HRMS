import { App, Button, Space, Table } from 'antd';
import { downloadFile } from '../../../api/client';

export type OnboardingFieldView = { name: string; type?: string; children?: OnboardingFieldView[] };
export type OnboardingAnswersView = Record<string, unknown>;
export function OnboardingAnswer({ field, value }: { field: OnboardingFieldView; value: unknown }) {
  const { message } = App.useApp();
  if (field.type === 'attachment') {
    const files = Array.isArray(value) ? value as Array<{ id: string; name: string }> : [];
    return files.length ? <Space direction="vertical" size={0}>{files.map(file => <Button type="link" key={file.id} style={{ padding: 0, height: 'auto' }} onClick={() => void downloadFile(`/admin/onboarding-form/attachments/${encodeURIComponent(file.id)}`, file.name).catch((error: Error) => message.error(error.message))}>{file.name}</Button>)}</Space> : <>未填写</>;
  }
  if (Array.isArray(value)) return value.length ? <Table size="small" rowKey="key" dataSource={(value as Record<string, unknown>[]).map((values, index) => ({ key: index, values }))} pagination={false} scroll={{ x: true }} columns={(field.children || []).map(child => ({ title: child.name, render: (_: unknown, row: { values: Record<string, unknown> }) => <OnboardingAnswer field={child} value={row.values[child.name]} /> }))} /> : <>未填写</>;
  return <>{typeof value === 'string' || typeof value === 'number' ? value : '未填写'}</>;
}
export interface ArchivedOnboarding {
  template: OnboardingFieldView[]; answers: OnboardingAnswersView | null;
  photo?: string | null; signature?: string | null; declaration?: string | null;
  declarationAccepted?: boolean | null; archivedAt: string; submittedAt: string;
}
export function OnboardingSubmission({ record }: { record: ArchivedOnboarding }) {
  return <div>
    {record.template.map(field => {
      const value = record.answers?.[field.name];
      return <div key={field.name} style={{ marginBottom: 12 }}><b>{field.name}：</b><OnboardingAnswer field={field} value={value} /></div>;
    })}
    <Space direction="vertical">
      <div><b>照片：</b>{record.photo ? <img src={record.photo} alt="员工照片" style={{ maxWidth: 150, maxHeight: 150, verticalAlign: 'top' }} /> : '未填写'}</div>
      <div><b>签名：</b>{record.signature ? <img src={record.signature} alt="员工手写签名" style={{ maxWidth: 280, maxHeight: 150, verticalAlign: 'top', border: '1px solid #eee' }} /> : '未填写'}</div>
    </Space>
    {record.declaration && <div style={{ marginTop: 16 }}><b>声明：</b><p>{record.declaration}</p><p>{record.declarationAccepted ? '员工已勾选确认' : '员工未勾选确认'}</p></div>}
  </div>;
}
