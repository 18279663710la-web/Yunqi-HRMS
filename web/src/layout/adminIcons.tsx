import type { ReactNode } from 'react';

// 后台侧栏统一使用的简洁线性图标：2px 圆头描边，替代默认细节较多的 AntD 图标。
function IconBase({ children, size = 20, label }: { children: ReactNode; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function DashboardIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </IconBase>
  );
}

export function EmployeesIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <circle cx="12" cy="7.8" r="3.6" />
      <path d="M5.5 20c.9-3.7 3.4-5.7 6.5-5.7s5.6 2 6.5 5.7" />
    </IconBase>
  );
}

export function HrIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <circle cx="9" cy="10.8" r="2" />
      <path d="M6.3 16.2c.5-1.7 1.7-2.5 2.7-2.5s2.2.8 2.7 2.5" />
      <path d="M14.5 10h3.8M14.5 13.8h3.8" />
    </IconBase>
  );
}

export function AttendanceIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2.2" />
    </IconBase>
  );
}

export function ModelsIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <path d="M6 3.5v5.5M6 14.5v6M12 3.5v10M12 19.5v1M18 3.5v3M18 11.5v9" />
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="12" cy="16.5" r="2.2" />
      <circle cx="18" cy="8.5" r="2.2" />
    </IconBase>
  );
}

export function ApprovalsIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <rect x="5" y="3.5" width="14" height="17" rx="2.2" />
      <path d="m9 12.6 2.2 2.2 4.3-4.6" />
    </IconBase>
  );
}

export function NoticesIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <path d="M18 10a6 6 0 1 0-12 0c0 4-2 5.6-2 5.6h16S18 14 18 10z" />
      <path d="M10.2 19a2.1 2.1 0 0 0 3.6 0" />
    </IconBase>
  );
}

export function DepartmentsIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <rect x="9" y="3" width="6" height="5" rx="1.3" />
      <rect x="3.5" y="16" width="6" height="5" rx="1.3" />
      <rect x="14.5" y="16" width="6" height="5" rx="1.3" />
      <path d="M12 8v3.5M6.5 16v-2.2c0-.7.6-1.3 1.3-1.3h8.4c.7 0 1.3.6 1.3 1.3V16M12 11.5v1.2" />
    </IconBase>
  );
}

export function AdminsIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <path d="M12 3.5 19.5 6.2v5.6c0 4.6-3.1 7.7-7.5 8.7-4.4-1-7.5-4.1-7.5-8.7V6.2L12 3.5z" />
    </IconBase>
  );
}

export function LockIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </IconBase>
  );
}

export function LogoutIcon({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <IconBase size={size} label={label}>
      <path d="M13.5 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h7.5" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </IconBase>
  );
}
