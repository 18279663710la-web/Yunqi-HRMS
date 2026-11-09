import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  App as AntApp,
  Avatar,
  ConfigProvider,
  Dropdown,
  Form,
  Input,
  Layout,
  Menu,
  Modal,
} from 'antd';
import {
  ClockCircleOutlined,
  DashboardOutlined,
  LockOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  TeamOutlined,
  RightOutlined,
  CloseOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

import { changePassword } from '../modules/auth/api';
import { useAuth } from '../auth/AuthContext';
import { BrandSymbol } from '../components/BrandSymbol';
import { accessibleSubModules, SUB_MODULES, matchSubModule, resolvePageKey, subModuleMetrics, type SubModule } from './subModules';
import { AdminPageRoutes } from './AdminPageRoutes';
import { WorkspaceActiveContext } from './WorkspaceContext';
import { closeWorkspaceTab, createWorkspaceTabs, openWorkspaceTab, workspaceTabForLocation, type WorkspaceTab } from './workspaceTabs';

const { Header, Sider, Content } = Layout;

interface PasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

function WorkspacePane({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const paneRef = useRef<HTMLDivElement>(null);
  return <div ref={paneRef} className="workspace-pane" role="tabpanel" id={`workspace-panel-${encodeURIComponent(tab.key)}`} aria-labelledby={`workspace-tab-${encodeURIComponent(tab.key)}`} hidden={!active}>
    <WorkspaceActiveContext.Provider value={active}>
    <ConfigProvider getPopupContainer={() => paneRef.current ?? document.body}>
      <AdminPageRoutes location={tab.location} />
    </ConfigProvider>
    </WorkspaceActiveContext.Provider>
  </div>;
}

export function AdminLayout() {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openModuleKey, setOpenModuleKey] = useState<string | null>(null);
  const [tabs, setTabs] = useState(() => createWorkspaceTabs(location));
  const closingTab = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsListRef = useRef<HTMLDivElement>(null);
  const activeTabKey = workspaceTabForLocation(location).key;
  const visibleTabs = closingTab.current === activeTabKey ? tabs : openWorkspaceTab(tabs, location);
  const triggerRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const sidebarRefs = useRef<Record<string, HTMLElement | null>>({});
  const [form] = Form.useForm<PasswordForm>();

  useEffect(() => {
    if (closingTab.current === activeTabKey) return;
    closingTab.current = null;
    setTabs(previous => openWorkspaceTab(previous, location));
  }, [location, activeTabKey]);

  useEffect(() => {
    const list = tabsListRef.current;
    const button = tabRefs.current[activeTabKey];
    if (!list || !button) return;
    const bounds = list.getBoundingClientRect();
    const tabBounds = button.parentElement?.getBoundingClientRect() ?? button.getBoundingClientRect();
    if (tabBounds.left < bounds.left) list.scrollLeft += tabBounds.left - bounds.left;
    else if (tabBounds.right > bounds.right) list.scrollLeft += tabBounds.right - bounds.right;
  }, [activeTabKey, visibleTabs.length]);

  useEffect(() => {
    for (const module of SUB_MODULES) {
      const sidebar = sidebarRefs.current[module.key];
      if (!sidebar) continue;
      if (openModuleKey !== module.key && sidebar.contains(document.activeElement)) triggerRefs.current[module.key]?.closest<HTMLElement>('[role="menuitem"]')?.focus();
      sidebar.inert = openModuleKey !== module.key;
    }
  }, [openModuleKey, admin?.role]);

  useEffect(() => {
    if (!openModuleKey) return;
    const module = accessibleSubModules(admin?.role).find(item => item.key === openModuleKey);
    if (!module) return;
    const onPointerDown = (event: PointerEvent) => {
      const path = event.composedPath();
      const sidebar = sidebarRefs.current[module.key];
      const trigger = triggerRefs.current[module.key]?.closest<HTMLElement>('[role="menuitem"]');
      if ((sidebar && path.includes(sidebar)) || (trigger && path.includes(trigger))) return;
      setOpenModuleKey(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [openModuleKey, admin?.role]);

  const selectedKey = useMemo(() => resolvePageKey(location.pathname), [location.pathname]);
  const primaryKey = matchSubModule(location.pathname)?.key ?? selectedKey;
  const visitTab = (destination: Location) => {
    setOpenModuleKey(null);
    navigate({ pathname: destination.pathname, search: destination.search, hash: destination.hash }, { state: destination.state });
  };
  const closeTab = (key: string) => {
    const result = closeWorkspaceTab(visibleTabs, key, activeTabKey);
    if (result.nextLocation) {
      closingTab.current = key;
      visitTab(result.nextLocation);
    }
    setTabs(result.tabs);
  };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % visibleTabs.length;
    else if (event.key === 'ArrowLeft') next = (index + visibleTabs.length - 1) % visibleTabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    const destination = visibleTabs[next];
    visitTab(destination.location);
    tabRefs.current[destination.key]?.focus();
  };
  const moduleItem = (module: SubModule) => ({
    key: module.key,
    icon: module.icon,
    'aria-expanded': openModuleKey === module.key,
    'aria-controls': module.sidebarId,
    label: <span ref={element => { triggerRefs.current[module.key] = element; }} className="sub-sidebar-trigger"><span>{module.title}</span><RightOutlined aria-hidden="true" className={openModuleKey === module.key ? 'is-open' : ''} /></span>,
  });
  const hrModule = SUB_MODULES.find(module => module.key === '/hr');
  const modelsModule = SUB_MODULES.find(module => module.key === '/models-formulas');
  const approvalsModule = SUB_MODULES.find(module => module.key === '/approvals');

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
    { key: '/employees', icon: <TeamOutlined />, label: '员工与账号' },
    ...(admin?.role === 'super_admin' && hrModule ? [moduleItem(hrModule)] : []),
    { key: '/attendance', icon: <ClockCircleOutlined />, label: '考勤管理' },
    ...(admin?.role === 'super_admin' && modelsModule ? [moduleItem(modelsModule)] : []),
    ...(approvalsModule ? [moduleItem(approvalsModule)] : []),
    { key: '/departments', icon: <TagsOutlined />, label: '组织架构' },
    ...(admin?.role === 'super_admin'
      ? [{ key: '/admins', icon: <SafetyCertificateOutlined />, label: '管理员账号' }]
      : []),
  ];

  const handleChangePassword = async (values: PasswordForm) => {
    setSaving(true);
    try {
      await changePassword(values.oldPassword, values.newPassword);
      message.success('密码已修改');
      setPasswordOpen(false);
      form.resetFields();
    } catch (err) {
      message.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout className="admin-shell is-sider-collapsed">
      <Sider width={236} collapsedWidth={72} collapsed className="admin-sider" theme="light">
        <div className="admin-brand">
          <div className="admin-brand-mark" aria-hidden="true"><BrandSymbol /></div>
          <div className="admin-brand-text">
            <div className="admin-brand-name">云枢办公</div>
            <div className="admin-brand-sub">管理后台</div>
          </div>
        </div>
        <Menu
          mode="inline"
          inlineCollapsed
          selectedKeys={[openModuleKey ?? primaryKey]}
          items={menuItems}
          className="admin-menu"
          onClick={({ key }) => {
            const module = SUB_MODULES.find(item => item.key === key);
            if (module) setOpenModuleKey(current => current === key ? null : key);
            else { setOpenModuleKey(null); navigate(key); }
          }}
        />
        <div className="admin-sider-foot">
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            menu={{
              items: [
                { key: 'password', icon: <LockOutlined />, label: '修改密码' },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'password') {
                  form.resetFields();
                  setPasswordOpen(true);
                }
                if (key === 'logout') {
                  logout();
                  navigate('/login', { replace: true });
                }
              },
            }}
          >
            <button type="button" className="admin-user" aria-label="管理员菜单" title={admin?.name || '管理员菜单'}>
              <Avatar size={36} icon={<UserOutlined />} style={{ background: '#3D6EF7' }} />
            </button>
          </Dropdown>
        </div>
      </Sider>

      {accessibleSubModules(admin?.role).map(module => {
        const metrics = subModuleMetrics(module);
        return <aside
          key={module.key}
          ref={element => { sidebarRefs.current[module.key] = element; }}
          id={module.sidebarId}
          className={`sub-sidebar${openModuleKey === module.key ? ' is-open' : ''}`}
          aria-label={`${module.title}子栏目`}
          aria-hidden={openModuleKey !== module.key}
          style={{ '--sub-sidebar-width': `${metrics.sidebarWidth}px`, '--sub-sidebar-item-width': `${metrics.itemWidth}px` } as CSSProperties}
        >
          <Menu
            mode="inline"
            className="sub-sidebar-menu"
            selectedKeys={[selectedKey]}
            items={module.items.map(item => ({ key: item.key, label: item.label, type: 'item' as const }))}
            onClick={({ key }) => { setOpenModuleKey(null); navigate(key); }}
          />
        </aside>;
      })}

      <Layout>
        <Header className="admin-header">
          <nav className="workspace-tabs" aria-label="已打开的页面">
            <div ref={tabsListRef} className="workspace-tabs-list" role="tablist" aria-label="页面标签">
              {visibleTabs.map((tab, index) => <div key={tab.key} role="presentation" className={`workspace-tab${activeTabKey === tab.key ? ' is-active' : ''}`}>
                <button ref={element => { tabRefs.current[tab.key] = element; }} id={`workspace-tab-${encodeURIComponent(tab.key)}`} type="button" className="workspace-tab-label" role="tab" aria-selected={activeTabKey === tab.key} aria-controls={`workspace-panel-${encodeURIComponent(tab.key)}`} tabIndex={activeTabKey === tab.key ? 0 : -1} onClick={() => visitTab(tab.location)} onKeyDown={event => onTabKeyDown(event, index)}>
                  {tab.key === '/dashboard' && <DashboardOutlined aria-hidden="true" />}{tab.label}
                </button>
                {tab.key !== '/dashboard' && <button type="button" className="workspace-tab-close" aria-label={`关闭${tab.label}`} onClick={() => closeTab(tab.key)}><CloseOutlined /></button>}
              </div>)}
            </div>
          </nav>

        </Header>

        <Content className="admin-content">
          {visibleTabs.map(tab => <WorkspacePane key={tab.key} tab={tab} active={activeTabKey === tab.key} />)}
        </Content>
      </Layout>

      <Modal
        title="修改密码"
        open={passwordOpen}
        onCancel={() => setPasswordOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleChangePassword} preserve={false}>
          <Form.Item
            name="oldPassword"
            label="原密码"
            rules={[{ required: true, message: '请输入原密码' }]}
          >
            <Input.Password placeholder="请输入原密码" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码至少 6 位' },
            ]}
          >
            <Input.Password placeholder="至少 6 位" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认新密码"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
