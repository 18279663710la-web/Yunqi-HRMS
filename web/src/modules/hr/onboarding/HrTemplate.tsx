import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Space, Typography } from 'antd';
import { getTaskTemplate, saveTaskTemplate, type TaskTemplateItem } from '../api';

export function HrTemplate() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [form] = Form.useForm<{ tasks: TaskTemplateItem[] }>();
  useEffect(() => {
    let active = true;
    getTaskTemplate().then((tasks) => { if (active) { form.setFieldsValue({ tasks }); setFailed(false); } }).catch((error: Error) => { if (active) { setFailed(true); message.error(error.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const submit = async (values: { tasks?: TaskTemplateItem[] }) => {
    setLoading(true);
    try { const tasks = await saveTaskTemplate(values.tasks || []); form.setFieldsValue({ tasks }); message.success('入职任务模板已保存'); }
    catch (error) { message.error((error as Error).message); }
    finally { setLoading(false); }
  };
  return <Card title="入职任务模板" className="panel-card" bordered={false} loading={loading}>
    {failed && <Alert type="error" message="模板加载失败，请刷新页面重试" showIcon style={{ marginBottom: 16 }} />}
    <Typography.Paragraph type="secondary">在办理入职时应用模板，任务会复制到该申请；修改模板不会改变已有任务。</Typography.Paragraph>
    <Typography.Paragraph type="secondary">开始偏移和持续天数按自然日计算；落在考勤设置中已配置的休息日时顺延，未配置日期不自动视为休息日。开始偏移可填负数。</Typography.Paragraph>
    <Form form={form} onFinish={submit} initialValues={{ tasks: [] }}>
      <Form.List name="tasks">{(fields, { add, remove }) => <>
        {fields.map(({ key, name, ...rest }) => <Card key={key} size="small" title={`任务 ${name + 1}`} extra={<Button onClick={() => remove(name)}>移除</Button>} style={{ marginBottom: 12 }}>
          <Form.Item {...rest} label="任务名称" name={[name, 'title']} rules={[{ required: true, whitespace: true, message: '填写任务名称' }]}><Input maxLength={100} /></Form.Item>
          <Form.Item {...rest} label="任务说明" name={[name, 'description']}><Input.TextArea maxLength={500} rows={2} /></Form.Item>
          <Space wrap align="baseline">
            <Form.Item {...rest} label="开始偏移（天）" name={[name, 'beginOn']}><InputNumber min={-3650} max={3650} precision={0} /></Form.Item>
            <Form.Item {...rest} label="持续（天）" name={[name, 'duration']}><InputNumber min={0} max={3650} precision={0} /></Form.Item>
            <Form.Item {...rest} name={[name, 'required']} valuePropName="checked"><Checkbox>建档前必需</Checkbox></Form.Item>
          </Space>
        </Card>)}
        <Form.Item><Button onClick={() => add({ title: '', required: true })} disabled={fields.length >= 30}>添加模板任务</Button></Form.Item>
      </>}</Form.List>
      <Button type="primary" htmlType="submit" loading={loading} disabled={failed}>保存模板</Button>
    </Form>
  </Card>;
}
