import * as attendanceApi from '../../services/attendance/api';
import type { AttendanceRecordView, AttendanceStats, AttendanceSummary } from '../../types/models';
import type { TapEvent } from '../../types/ui';
import { formatTime } from '../../utils/util';

/** 状态 -> 标签样式 */
const TAG_CLASS: Record<string, string> = {
  normal: 'tag-green',
  missing_in: 'tag-orange',
  missing_out: 'tag-orange',
  absent: 'tag-red',
  leave: 'tag-blue',
  rest: 'tag-gray',
  travel: 'tag-cyan',
};

interface RecordData {
  monthLabel: string;
  stats: AttendanceStats;
  filters: Array<{ key: string; name: string }>;
  filter: string;
  allRecords: AttendanceRecordView[];
  records: AttendanceRecordView[];
}

interface RecordCustom {
  load(): Promise<void>;
  filterRecords(list: AttendanceRecordView[], filter: string): AttendanceRecordView[];
  onFilter(e: TapEvent): void;
  applyFilter(): void;
}

Page<RecordData, RecordCustom>({
  data: {
    monthLabel: '',
    stats: {
      week: {} as AttendanceSummary,
      month: {} as AttendanceSummary,
      avgHours: '0.0',
      totalDays: 0,
    },
    filters: [
      { key: 'all', name: '全部' },
      { key: 'abnormal', name: '异常' },
      { key: 'leave', name: '请假' },
    ],
    filter: 'all',
    allRecords: [],
    records: [],
  },

  onShow() {
    void this.load();
  },

  async load(): Promise<void> {
    try {
      const [records, stats] = await Promise.all([attendanceApi.getAttendanceRecords(31), attendanceApi.getAttendanceStats()]);
      const allRecords: AttendanceRecordView[] = records.map((r) => ({
        ...r,
        tagClass: TAG_CLASS[r.status] || 'tag-gray',
      }));
      this.setData({
        monthLabel: formatTime(new Date(), 'YYYY 年 MM 月'),
        stats,
        allRecords,
        records: this.filterRecords(allRecords, this.data.filter),
      });
    } catch {
      // 请求层已提示
    }
  },

  filterRecords(list: AttendanceRecordView[], filter: string): AttendanceRecordView[] {
    if (filter === 'abnormal') {
      return list.filter((r) => r.status === 'missing_in' || r.status === 'missing_out' || r.status === 'absent');
    }
    if (filter === 'leave') {
      return list.filter((r) => r.status === 'leave');
    }
    return list;
  },

  onFilter(e: TapEvent) {
    this.setData({ filter: String(e.currentTarget.dataset.key || 'all') });
    this.applyFilter();
  },

  applyFilter() {
    this.setData({ records: this.filterRecords(this.data.allRecords, this.data.filter) });
  },
});
