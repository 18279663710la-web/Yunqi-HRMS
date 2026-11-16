import { Button, Card, Form, Input, InputNumber, Space } from 'antd';
import { buildRanges, validateRanges, type AttendanceRange, type AttendanceRuleMode } from './attendanceRuleModes';

export function AttendanceModeRulesFields({ mode }: { mode: AttendanceRuleMode }) {
  const form = Form.useFormInstance();
  const watched = Form.useWatch('attendanceRules', form) as AttendanceRange[] | undefined;
  const rules = Array.isArray(watched) ? watched : [];
  const days = mode.startsWith('days_');
  const label = `${mode.endsWith('absence') ? '缺勤' : '出勤'}${days ? '天数' : '率'}`;
  const unit = days ? '天' : '%';
  return <Card size="small" style={{ margin: '0 0 24px', borderColor: '#333333', background: '#1f1f1f' }}>
    <Form.List name="attendanceRules" rules={[{ validator: async (_, values: AttendanceRange[] | undefined) => { const error = validateRanges(mode, buildRanges(mode, values)); if (error) throw new Error(error); } }]}>
      {(fields, { add, remove }, { errors }) => {
        const last = fields.length - 1;
        const lastLower = last > 0 ? rules[last - 1]?.maxRate ?? 0 : 0;
        const canAdd = fields.length < 30 && (days ? lastLower < 999999 : lastLower < 99.99);
        const addRule = () => {
          if (!canAdd || last < 0) return;
          const split = days ? lastLower + 1 : Math.round((lastLower + 100) * 50) / 100;
          if (split <= lastLower || (!days && split >= 100)) return;
          form.setFieldValue(['attendanceRules', last, 'maxRate'], split);
          add({ minRate: split, maxRate: days ? null : 100, adjustment: 0 });
        };
        const deleteRule = (index: number) => {
          if (fields.length <= 1) return;
          const wasLast = index === last;
          remove(index);
          if (wasLast) form.setFieldValue(['attendanceRules', index - 1, 'maxRate'], days ? null : 100);
        };
        return <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {fields.map(({ key, name, ...rest }) => {
            const isLast = name === last;
            const lower = name === 0 ? 0 : rules[name - 1]?.maxRate ?? 0;
            return <Card size="small" key={key} title={`区间${name + 1}`} extra={fields.length > 1 ? <Button danger onClick={() => deleteRule(name)}>删除</Button> : undefined}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
                <Form.Item label={`${label}下限（${unit}，含）`} style={{ flex: '1 1 140px' }}><InputNumber value={lower} disabled precision={days ? 0 : 2} style={{ width: '100%' }} /></Form.Item>
                {isLast && days ? <Form.Item label={`${label}上限（${unit}）`} style={{ flex: '1 1 140px' }}><Input value="不限" disabled /></Form.Item> :
                  <Form.Item {...rest} name={[name, 'maxRate']} label={`${label}上限（${unit}，${isLast ? '含' : '不含'}）`} rules={[{ required: true, message: '请输入上限' }]} style={{ flex: '1 1 140px' }}>
                    <InputNumber min={days ? lower + 1 : Math.round((lower + 0.01) * 100) / 100} max={days ? 999999 : 100} precision={days ? 0 : 2} disabled={isLast} style={{ width: '100%' }} />
                  </Form.Item>}
                <Form.Item {...rest} name={[name, 'adjustment']} label="绩效调整（元）" rules={[{ required: true, message: '请输入调整金额' }]} style={{ flex: '1 1 140px' }}><InputNumber min={-9999999999.99} max={9999999999.99} precision={2} style={{ width: '100%' }} /></Form.Item>
              </div>
            </Card>;
          })}
          <Form.ErrorList errors={errors} />
          <div><Button onClick={addRule} disabled={!canAdd}>添加区间</Button></div>
        </Space>;
      }}
    </Form.List>
  </Card>;
}
