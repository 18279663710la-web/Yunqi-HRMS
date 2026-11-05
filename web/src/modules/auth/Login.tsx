import { useEffect, useState } from 'react';
import { App as AntApp, Alert, Button, Form, Input, Space, Typography } from 'antd';
import {
  ClockCircleOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';

interface LoginForm {
  username: string;
  password: string;
}

const FEATURES = [
  { icon: <TeamOutlined />, title: '员工与账号', desc: '创建员工档案，开通或停用小程序登录账号' },
  { icon: <ClockCircleOutlined />, title: '考勤管理', desc: '按部门/员工查询打卡，支持补卡与请假登记' },
  { icon: <TagsOutlined />, title: '组织架构', desc: '按研发员 / 业务员 / 员工三类汇总员工' },
  { icon: <SafetyCertificateOutlined />, title: '权限隔离', desc: '管理员账号分级，操作留痕可审计' },
];

export function LoginPage() {
  const { admin, login } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (admin) navigate('/dashboard', { replace: true });
  }, [admin, navigate]);

  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      await login(values.username.trim(), values.password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-panel login-panel-left">
        <div className="login-brand">
          <div className="login-brand-mark">云</div>
          <div>
            <div className="login-brand-name">云启办公</div>
            <div className="login-brand-sub">企业办公 · 管理后台</div>
          </div>
        </div>

        <div className="login-hero">
          <h1>把员工、账号与考勤<br />放进同一个工作台</h1>
          <p>与小程序端共用一套 MySQL 数据。员工在小程序打卡，管理员在这里查看、补录与维护账号。</p>
        </div>

        <div className="login-features">
          {FEATURES.map((item) => (
            <div className="login-feature" key={item.title}>
              <div className="login-feature-icon">{item.icon}</div>
              <div>
                <div className="login-feature-title">{item.title}</div>
                <div className="login-feature-desc">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="login-panel login-panel-right">
        <div className="login-card">
          <Typography.Title level={2} className="login-title">
            登录管理后台
          </Typography.Title>
          <Typography.Paragraph type="secondary" className="login-subtitle">
            请使用管理员账号登录。首次启动的默认账号见后端 <code>server/.env</code>。
          </Typography.Paragraph>

          <Alert
            type="info"
            showIcon
            className="login-hint"
            message="演示环境默认账号：admin / admin123456"
            description="首次登录后请立即在右上角「修改密码」中更换密码。"
          />

          <Form<LoginForm> layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="username"
              label="管理员账号"
              rules={[{ required: true, message: '请输入管理员账号' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="admin" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading} className="login-submit">
              登录
            </Button>
          </Form>

          <div className="login-foot">
            <Space size={6}>
              <span className="login-foot-dot" />
              <span>后端服务：127.0.0.1:3100</span>
            </Space>
            <span>v1.0.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
