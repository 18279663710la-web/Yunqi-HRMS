import { useEffect, useState } from 'react';
import { App as AntApp, Button, Form, Input, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../auth/AuthContext';

interface LoginForm {
  username: string;
  password: string;
}

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
    <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-visual" aria-hidden="true">
          <div className="login-visual-ring login-visual-ring-outer" />
          <div className="login-visual-ring login-visual-ring-inner" />
          <div className="login-visual-window">
            <div className="login-visual-sidebar">
              <span className="login-visual-logo">云</span>
              <span className="login-visual-nav is-active" />
              <span className="login-visual-nav" />
              <span className="login-visual-nav" />
              <span className="login-visual-nav" />
            </div>
            <div className="login-visual-content">
              <div className="login-visual-topbar"><span /><span /></div>
              <div className="login-visual-heading" />
              <div className="login-visual-stats"><span /><span /><span /></div>
              <div className="login-visual-chart">
                <div className="login-visual-chart-heading" />
                <div className="login-visual-bars"><i /><i /><i /><i /><i /><i /><i /></div>
              </div>
              <div className="login-visual-lines"><span /><span /><span /></div>
            </div>
          </div>
          <div className="login-visual-accent login-visual-accent-one" />
          <div className="login-visual-accent login-visual-accent-two" />
        </div>

        <div className="login-panel">
          <div className="login-card">
            <div className="login-brand">
              <div className="admin-brand-mark" aria-hidden="true">云</div>
              <div className="login-brand-name">云启办公</div>
            </div>

            <Typography.Title id="login-title" level={1} className="login-title">
              登录管理后台
            </Typography.Title>

            <Form<LoginForm> layout="vertical" size="large" onFinish={onFinish} requiredMark={false}>
              <Form.Item
                name="username"
                label="管理员账号"
                rules={[{ required: true, message: '请输入管理员账号' }]}
              >
                <Input prefix={<UserOutlined />} placeholder="请输入管理员账号" autoComplete="username" />
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
          </div>
        </div>
      </section>
    </main>
  );
}
