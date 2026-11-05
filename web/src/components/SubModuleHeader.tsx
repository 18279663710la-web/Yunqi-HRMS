import type { ReactNode } from 'react';
import { Typography } from 'antd';

export function SubModuleHeader({ title, extra }: { title: string; extra?: ReactNode }) {
  return <div className="submodule-header">
    <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
    {extra ? <div className="submodule-header-extra">{extra}</div> : null}
  </div>;
}
