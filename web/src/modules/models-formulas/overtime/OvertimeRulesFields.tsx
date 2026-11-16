import { Button, Card, Form, InputNumber, Space } from 'antd';
import type { OvertimeRuleDraft } from './overtimeConfig';

interface OvertimeRulesFieldsProps {
  rules: OvertimeRuleDraft[];
  onUpperChange: (index: number, value: number | null) => void;
  onRateChange: (index: number, value: number | null) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
}

export function OvertimeRulesFields({ rules, onUpperChange, onRateChange, onRemove, onAdd }: OvertimeRulesFieldsProps) {
  return <Card
    size="small"
    style={{ margin: '0 0 24px', borderColor: '#333333', background: '#1f1f1f' }}
  >
    <div id="overtime-rules-body">
      <Form component={false} layout="vertical">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {rules.map((rule, index) => <Card size="small" key={index} title={`区间${index + 1}`}
            extra={rules.length > 1 ? <Button danger onClick={() => onRemove(index)}>删除</Button> : undefined}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
              <Form.Item label="加班时长下限（小时）" style={{ flex: '1 1 140px' }}>
                <InputNumber aria-label={`区间${index + 1}最小时长`} value={rule.minHours} disabled precision={2} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="加班时长上限（小时）" required={rule.maxHours !== null} style={{ flex: '1 1 140px' }}>
                <InputNumber aria-label={`区间${index + 1}最大时长`} min={0} max={1000000} precision={2} value={rule.maxHours} placeholder={rule.maxHours === null ? '无上限' : undefined} disabled={rule.maxHours === null} onChange={value => onUpperChange(index, value)} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item label="每小时金额（元）" required style={{ flex: '1 1 140px' }}>
                <InputNumber aria-label={`区间${index + 1}每小时金额`} min={0} max={9999999999.99} precision={2} value={rule.hourlyRate} onChange={value => onRateChange(index, value)} style={{ width: '100%' }} />
              </Form.Item>
            </div>
          </Card>)}
          <Button disabled={!rules.length || rules.length >= 30} onClick={onAdd}>添加区间</Button>
        </Space>
      </Form>
    </div>
  </Card>;
}
