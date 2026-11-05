import { Button, Card, Form, InputNumber, Space, Tag, Tooltip } from 'antd';
import { buildAttendanceRules, validateAttendanceRules, type AttendanceRule } from './attendanceRules';

export function AttendanceRulesFields() {
  const form = Form.useFormInstance();
  const watchedRules = Form.useWatch('attendanceRules', form) as AttendanceRule[] | undefined;
  const rules = Array.isArray(watchedRules) ? watchedRules : [];
  return <Card
    size="small"
    style={{ margin: '0 0 24px', borderColor: '#ccd8ea', background: '#f8faff' }}
  >
    <div id="attendance-rules-body">
    <Form.List name="attendanceRules" rules={[{ validator: async (_, values: AttendanceRule[] | undefined) => { const error = validateAttendanceRules(buildAttendanceRules(values)); if (error) throw new Error(error); } }]}>
      {(fields, { add, remove }, { errors }) => {
        const lastIndex = fields.length - 1;
        const lastMax = lastIndex > 0 ? rules[lastIndex - 1]?.minRate ?? 100 : 100;
        const canAdd = fields.length >= 2 && lastMax > 0.01;
        const addRule = () => {
          const current = (form.getFieldValue('attendanceRules') as AttendanceRule[] | undefined) ?? [];
          const index = current.length - 1;
          const previousMin = index > 0 ? current[index - 1]?.minRate ?? 100 : 100;
          if (index < 1 || previousMin <= 0.01) return;
          const split = Math.round((previousMin / 2) * 100) / 100;
          if (!(split > 0 && split < previousMin)) return;
          form.setFieldValue(['attendanceRules', index, 'minRate'], split);
          add({ minRate: 0, maxRate: split, adjustment: 0 });
        };
        const deleteRule = (index: number) => {
          if (index === 0 || fields.length <= 2) return;
          const removingLast = index === fields.length - 1;
          remove(index);
          if (removingLast) form.setFieldValue(['attendanceRules', index - 1, 'minRate'], 0);
        };
        return <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {fields.map(({ key, name, ...rest }) => {
            const isFull = name === 0;
            const isLast = name === fields.length - 1;
            const internal = !isFull && !isLast;
            const previousMin = name === 0 ? 100 : rules[name - 1]?.minRate ?? 100;
            const maxRate = isFull ? 100 : previousMin;
            return <Card size="small" key={key} title={<Space><span>规则 {name + 1}</span>{isFull && <Tag color="blue">全勤</Tag>}</Space>}
              extra={isFull ? undefined : <Tooltip title={fields.length <= 2 ? '至少保留一条区间规则' : undefined}><span><Button danger disabled={fields.length <= 2} onClick={() => deleteRule(name)}>删除</Button></span></Tooltip>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
                <Form.Item {...rest} name={[name, 'minRate']} label="出勤率下限（%）" rules={internal ? [{ required: true, message: '请输入下限' }] : undefined} style={{ flex: '1 1 140px' }}>
                  <InputNumber min={internal ? 0.01 : isFull ? 100 : 0} max={internal ? Math.max(0.01, Math.round((previousMin - 0.01) * 100) / 100) : isFull ? 100 : 0} precision={2} disabled={!internal} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="出勤率上限（%）" style={{ flex: '1 1 140px' }}>
                  <InputNumber value={maxRate} precision={2} disabled style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item {...rest} name={[name, 'adjustment']} label="绩效调整（元）" rules={[{ required: true, message: '请输入调整金额' }]} style={{ flex: '1 1 140px' }}>
                  <InputNumber min={-9999999999.99} max={9999999999.99} precision={2} style={{ width: '100%' }} />
                </Form.Item>
              </div>
            </Card>;
          })}
          <Form.ErrorList errors={errors} />
          <Space wrap>
            <Tooltip title={fields.length >= 2 && !canAdd ? '当前最小区间过小，无法继续拆分' : undefined}>
              <span><Button onClick={addRule} disabled={!canAdd || fields.length >= 30}>添加区间</Button></span>
            </Tooltip>
          </Space>
        </Space>;
      }}
    </Form.List>
    </div>
  </Card>;
}
