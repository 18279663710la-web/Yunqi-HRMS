import { useEffect, useState } from 'react';
import { App, Select } from 'antd';
import { getApprovalApproverSettings, setApprovalApprover, type CustomApprovalType } from './api';

export function FallbackApproverSelect({ approvalType }: { approvalType: string }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<string | undefined>();
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getApprovalApproverSettings(approvalType).then((result) => {
      if (!active) return;
      setValue(result.approver?.id);
      setOptions(result.candidates.filter((item) => item.active).map((item) => ({ value: item.id, label: item.employeeNo ? `${item.name} ${item.employeeNo}` : item.name })));
    }).catch((error: Error) => {
      if (active) message.error(error.message || '审批人加载失败');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [approvalType, message]);

  return (
    <Select
      className="approval-fallback-approver"
      aria-label="指定审批人"
      placeholder="指定审批人"
      showSearch
      optionFilterProp="label"
      loading={loading}
      disabled={loading || saving}
      value={value}
      options={options}
      onChange={(employeeId: string) => {
        const previous = value;
        setValue(employeeId);
        setSaving(true);
        setApprovalApprover(approvalType, employeeId).catch((error: Error) => {
          setValue(previous);
          message.error(error.message || '保存失败');
        }).finally(() => setSaving(false));
      }}
    />
  );
}
