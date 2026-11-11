import * as attendanceApi from '../../services/attendance/api';
import type { AttendanceSettings, AttendanceStats, AttendanceSummary, OvertimePunch, TodayAttendance } from '../../types/models';
import { getCustomTabBar, type TapEvent } from '../../types/ui';
import { formatTime, toast } from '../../utils/util';

interface LocationState {
  ok: boolean;
  fallback: boolean;
  privacyIssue: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

interface AttendanceView extends TodayAttendance {
  canPunch: boolean;
  inNote: string;
  outNote: string;
  inLate: boolean;
  todayStatusClass: string;
}

interface AttendanceData {
  time: string;
  timeShort: string;
  date: string;
  weekday: string;
  attendance: AttendanceView;
  location: LocationState;
  locationText: string;
  punchTip: string;
  stats: AttendanceStats;
  punching: boolean;
  punchSuccess: boolean;
  site: AttendanceSettings | null;
  overtime: OvertimePunch[];
}

interface AttendanceCustom {
  timer: number | null;
  tick(): void;
  initLocation(): Promise<LocationState | null>;
  loadData(): Promise<void>;
  onTapLocation(): void;
  onPunch(): Promise<void>;
  onOvertimePunch(event: TapEvent): Promise<void>;
  refreshBadge(): void;
  goRecord(): void;
}

Page<AttendanceData, AttendanceCustom>({
  data: {
    time: '--:--:--',
    timeShort: '--:--',
    date: '',
    weekday: '',
    attendance: {} as AttendanceView,
    location: { ok: false, fallback: false, privacyIssue: false },
    locationText: '正在获取定位…',
    punchTip: '',
    stats: {
      week: {} as AttendanceSummary,
      month: {} as AttendanceSummary,
      avgHours: '0.0',
      totalDays: 0,
    },
    punching: false,
    punchSuccess: false,
    site: null,
    overtime: [],
  },

  timer: null,

  onLoad() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    void this.initLocation();
  },

  onShow() {
    // 从其他页面返回时恢复时钟
    if (this.timer) clearInterval(this.timer);
    this.tick();
    this.timer = setInterval(() => this.tick(), 1000);
    void this.loadData();
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  onHide() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  onPullDownRefresh() {
    return this.loadData().then(() => { wx.stopPullDownRefresh(); });
  },

  /* ---------------- 时钟 ---------------- */

  tick() {
    const now = new Date();
    const previousMinute = this.data.timeShort;
    const timeShort = formatTime(now, 'HH:mm');
    this.setData({
      time: formatTime(now, 'HH:mm:ss'),
      timeShort,
      date: formatTime(now, 'YYYY年MM月DD日'),
      weekday: `星期${'日一二三四五六'[now.getDay()]}`,
    });
    if (previousMinute !== '--:--' && previousMinute !== timeShort) void this.loadData();
  },

  /* ---------------- 定位 ---------------- */

  async initLocation(): Promise<LocationState | null> {
    return new Promise((resolve) => wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      highAccuracyExpireTime: 5000,
      success: (res) => {
        const location = { ok: true, fallback: false, privacyIssue: false,
          latitude: res.latitude, longitude: res.longitude, accuracy: res.accuracy };
        this.setData({
          location,
          locationText: `已获取定位，精度约 ${Math.round(res.accuracy)} 米`,
        });
        resolve(location);
      },
      fail: (err) => {
        // 1) 未在后台「用户隐私保护指引」声明位置信息（errno 112）
        // 2) 用户主动拒绝位置权限
        const fail = err as { errMsg?: string; errno?: number };
        const msg = fail.errMsg || '';
        const privacyIssue = msg.includes('privacy agreement') || fail.errno === 112;

        this.setData({
          location: { ok: false, fallback: true, privacyIssue },
          locationText: privacyIssue
            ? '未完成隐私声明，无法获取定位'
            : '未获取到定位，请检查权限后重试',
        });
        resolve(null);
      },
    }));
  },

  onTapLocation() {
    const { location } = this.data;

    // 定位正常，点击即刷新
    if (!location.fallback) {
      void this.initLocation();
      return;
    }

    // 隐私声明缺失属于开发者侧配置问题，引导用户去「设置」是无效的
    if (location.privacyIssue) {
      wx.showModal({
        title: '定位能力尚未启用',
        content:
          '请在小程序后台完善位置信息的隐私保护指引后重试。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    // 用户自己拒绝了权限，引导到设置页开启
    wx.showModal({
      title: '需要位置权限',
      content: '考勤打卡需要获取你的位置以校验是否在办公区域，请在设置中开启位置权限。',
      confirmText: '去设置',
      success: (res) => {
        if (res.confirm) void wx.openSetting({});
      },
    });
  },

  /* ---------------- 数据 ---------------- */

  async loadData(): Promise<void> {
    try {
      const [attendance, stats, site, overtime] = await Promise.all([attendanceApi.getTodayAttendance(), attendanceApi.getAttendanceStats(), attendanceApi.getAttendanceSettings(), attendanceApi.getOvertimePunches()]);

      let punchTip = '';
      if (attendance.nextType === 'in') {
        punchTip = `上班卡时间段 ${site?.startTime || ''} - ${attendance.inEndTime || ''}`;
      } else if (attendance.nextType === 'out') {
        punchTip = `下班卡时间段 ${site?.endTime || ''} - ${attendance.outEndTime || ''}`;
      } else if (attendance.nextType === 'done') {
        punchTip = attendance.nextText;
      } else {
        punchTip = attendance.nextText;
      }

      const statusClassMap: Record<string, string> = {
        normal: 'tag-green',
        rest: 'tag-gray',
        leave: 'tag-blue',
        absent: 'tag-red',
      };

      this.setData({
        attendance: {
          ...attendance,
          canPunch: attendance.nextType === 'in' || attendance.nextType === 'out',
          inNote: attendance.checkIn ? '已打卡' : '未打卡',
          outNote: attendance.checkOut ? '已打卡' : '未打卡',
          inLate: false,
          todayStatusClass: statusClassMap[attendance.status] || 'tag-orange',
        },
        stats,
        site,
        overtime,
        punchTip,
      });
    } catch {
      // 请求层已提示
    }
  },

  /* ---------------- 打卡 ---------------- */

  async onOvertimePunch(event: TapEvent): Promise<void> {
    if (this.data.punching) return;
    const approvalId = String(event.currentTarget.dataset.id || '');
    const item = this.data.overtime.find(entry => entry.approvalId === approvalId);
    if (!item || !item.canPunch) { toast('尚未到加班开始时间'); return; }
    this.setData({ punching: true });
    try {
      const location = await this.initLocation();
      if (!location) { toast('获取定位失败，请检查权限'); return; }
      const result = await attendanceApi.punchOvertime(item.approvalId, item.nextType, { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy });
      toast(result.message);
      await this.loadData();
    } catch {
      // 请求层已提示
    } finally { this.setData({ punching: false }); }
  },

  async onPunch(): Promise<void> {
    const { attendance, punching, site } = this.data;
    if (punching) return;

    if (attendance.nextType === 'done') {
      toast(attendance.nextText);
      return;
    }
    if (attendance.nextType === 'wait') {
      toast(attendance.nextText);
      return;
    }
    if (attendance.nextType !== 'in' && attendance.nextType !== 'out') return;
    if (!site) {
      toast('管理员尚未设置打卡地点');
      return;
    }

    this.setData({ punching: true });
    try {
      const location = await this.initLocation();
      if (!location) {
        this.setData({ punching: false });
        toast('获取定位失败，请检查权限');
        return;
      }
      const res = await attendanceApi.punch(attendance.nextType, {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
      });
      this.setData({ punching: false });

      if (!res.ok) {
        toast(res.message);
        await this.loadData();
        return;
      }

      try {
        wx.vibrateShort({ type: 'medium' });
      } catch {
        /* 部分环境不支持震动 */
      }

      this.setData({ punchSuccess: true });
      setTimeout(() => this.setData({ punchSuccess: false }), 1400);
      wx.showToast({ title: res.message, icon: 'success', duration: 1600 });
      await this.loadData();
      this.refreshBadge();
    } catch {
      this.setData({ punching: false });
    }
  },

  refreshBadge() {
    const tabBar = getCustomTabBar(this);
    if (tabBar) tabBar.refreshBadge();
  },

  goRecord() {
    wx.navigateTo({ url: '/pages/record/record' });
  },
});
