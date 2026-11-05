import { Space, Table } from 'antd';

export type OnboardingFieldView = { name: string; children?: OnboardingFieldView[] };
export type OnboardingAnswersView = Record<string, string | number | Record<string, string | number>[]>;
export interface ArchivedOnboarding {
  template: OnboardingFieldView[]; answers: OnboardingAnswersView | null;
  photo?: string | null; signature?: string | null; declaration?: string | null;
  declarationAccepted?: boolean | null; archivedAt: string; submittedAt: string;
}
export function OnboardingSubmission({ record }: { record: ArchivedOnboarding }) {
  return <div>
    {record.template.map(field => {
      const value = record.answers?.[field.name];
      return <div key={field.name} style={{ marginBottom: 12 }}><b>{field.name}：</b>{Array.isArray(value)
        ? value.length ? <Table size="small" rowKey="key" dataSource={value.map((values, index) => ({ key: index, values }))} pagination={false} scroll={{ x: true }} columns={(field.children || []).map(child => ({ title: child.name, render: (_: unknown, row: { values: Record<string, string | number> }) => row.values[child.name] ?? '—' }))} /> : '未填写'
        : value ?? '未填写'}</div>;
    })}
    <Space direction="vertical">
      <div><b>照片：</b>{record.photo ? <img src={record.photo} alt="员工照片" style={{ maxWidth: 150, maxHeight: 150, verticalAlign: 'top' }} /> : '未填写'}</div>
      <div><b>签名：</b>{record.signature ? <img src={record.signature} alt="员工手写签名" style={{ maxWidth: 280, maxHeight: 150, verticalAlign: 'top', border: '1px solid #eee' }} /> : '未填写'}</div>
    </Space>
    {record.declaration && <div style={{ marginTop: 16 }}><b>声明：</b><p>{record.declaration}</p><p>{record.declarationAccepted ? '员工已勾选确认' : '员工未勾选确认'}</p></div>}
  </div>;
}
