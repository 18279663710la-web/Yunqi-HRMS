import {
  AuditOutlined,
  CalculatorOutlined,
  EditOutlined,
  FileTextOutlined,
  ImportOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { PayrollWorkflowNodeKind } from '../../hr/api';

const icons: Record<PayrollWorkflowNodeKind, ReactNode> = {
  'system-calc': <CalculatorOutlined />,
  'manual-adjust': <EditOutlined />,
  review: <AuditOutlined />,
  payslip: <FileTextOutlined />,
  'send-miniprogram': <SendOutlined />,
  'import-fields': <ImportOutlined />,
};

export function PayrollWorkflowIcon({ kind }: { kind: PayrollWorkflowNodeKind }) {
  return <span className={`workflow-node-icon is-${kind}`} aria-hidden="true">{icons[kind]}</span>;
}
