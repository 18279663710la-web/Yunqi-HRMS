import type { ReactNode } from 'react';

interface PageTitleProps {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

export function PageTitle({ title, subtitle, extra }: PageTitleProps) {
  return (
    <div className="page-title-row">
      <div>
        <h2 className="page-title">{title}</h2>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {extra ? <div className="page-title-extra">{extra}</div> : null}
    </div>
  );
}
