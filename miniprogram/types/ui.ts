/** 页面事件与自定义 tabBar 的类型辅助 */

export interface TapEvent {
  currentTarget: {
    dataset: Record<string, any>;
  };
}

export interface InputEvent {
  currentTarget: {
    dataset: Record<string, any>;
  };
  detail: {
    value: string;
  };
}

export interface PickerEvent {
  currentTarget: {
    dataset: Record<string, any>;
  };
  detail: {
    value: string | number;
  };
}

export interface SwitchEvent {
  detail: {
    value: boolean;
  };
}

export interface CustomEvent<T> {
  detail: T;
}

export interface CustomTabBar {
  setData(data: Record<string, any>): void;
  refreshBadge(): void;
}

/** 页面 onShow 中同步自定义 tabBar 选中态与角标 */
export function getCustomTabBar(page: unknown): CustomTabBar | null {
  const target = page as { getTabBar?: () => CustomTabBar | null };
  if (typeof target.getTabBar !== 'function') return null;
  return target.getTabBar();
}
