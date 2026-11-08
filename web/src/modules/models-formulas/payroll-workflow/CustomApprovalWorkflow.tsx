import { useEffect, useState } from 'react';
import { DragOutlined, PlusOutlined, SelectOutlined } from '@ant-design/icons';
import { Select } from 'antd';
import { ReactFlowProvider } from '@xyflow/react';
import { PayrollWorkflowCanvas, type PayrollWorkflowTool } from './PayrollWorkflowCanvas';

const noop = () => {};
const APPROVAL_TYPES = [
  { value: 'leave', label: '请假审批' },
  { value: 'expense', label: '报销审批' },
  { value: 'overtime', label: '加班审批' },
  { value: 'travel', label: '出差审批' },
  { value: 'purchase', label: '采购审批' },
];

export function CustomApprovalWorkflow() {
  const [mounted, setMounted] = useState(false);
  const [tool, setTool] = useState<PayrollWorkflowTool>('select');
  const [approvalType, setApprovalType] = useState<string>();
  useEffect(() => { setMounted(true); }, []);

  return <section className="payroll-workflow-page custom-approval-workflow" aria-label="自定义审批流程">
    <div className="salary-model-entries" role="toolbar" aria-label="流程操作">
      <Select className="approval-type-select" aria-label="选择审批类型" showSearch optionFilterProp="label" placeholder="选择审批类型" value={approvalType} onChange={setApprovalType} options={APPROVAL_TYPES} />
      <button className="salary-model-entry" type="button" disabled>清空</button>
      <button className="salary-model-entry" type="button" disabled>保存</button>
    </div>
    <div className="payroll-workflow-editor">
      <div className="workflow-stage">
        <div className="workflow-rail" role="toolbar" aria-label="画布工具">
          <button type="button" className="workflow-rail-button" aria-label="添加节点" disabled><PlusOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'select' ? ' is-active' : ''}`} aria-label="选择模式" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><SelectOutlined /></button>
          <button type="button" className={`workflow-rail-button${tool === 'pan' ? ' is-active' : ''}`} aria-label="平移模式" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><DragOutlined /></button>
        </div>
        {mounted ? <ReactFlowProvider><PayrollWorkflowCanvas
          nodes={[]}
          edges={[]}
          onNodesChange={noop}
          onEdgesChange={noop}
          onConnect={noop}
          onNodesDelete={noop}
          onDropNode={noop}
          onPlaceNode={noop}
          onQuickAdd={noop}
          placingKind={null}
          tool={tool}
          fitSignal={0}
        /></ReactFlowProvider> : <div className="workflow-canvas-placeholder" />}
      </div>
    </div>
  </section>;
}
