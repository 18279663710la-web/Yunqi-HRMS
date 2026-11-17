/** 仅测试夹具使用：为演示员工生成考勤与今日打卡，生产初始化不调用。 */
import type { PoolConnection } from 'mysql2/promise';

import { transaction } from './pool';
import { dateKey, isWorkday, pad, parseDateKey, seededRand } from '../utils/datetime';

interface SeedPunch {
  employeeId: string;
  day: string;
  checkIn: string | null;
  checkOut: string | null;
  statusOverride: 'leave' | 'absent' | null;
}

function buildSeedPunches(employeeId: string, days: number): SeedPunch[] {
  const now = new Date();
  const list: SeedPunch[] = [];

  for (let i = 1; i <= days; i += 1) {
    const d = new Date(now.getTime() - i * 86400000);
    const day = dateKey(d);
    const dayIndex = Math.floor(parseDateKey(day).getTime() / 86400000);
    const r1 = seededRand(dayIndex);
    const r2 = seededRand(dayIndex + 77);

    if (!isWorkday(d)) {
      // 周末以休息为主，少量加班记录
      if (r1 < 0.12) {
        list.push({
          employeeId,
          day,
          checkIn: '10:00',
          checkOut: r2 > 0.5 ? '16:00' : '15:30',
          statusOverride: null,
        });
      }
      continue;
    }

    if (r1 < 0.04) {
      list.push({ employeeId, day, checkIn: null, checkOut: null, statusOverride: 'absent' });
      continue;
    }
    if (r1 < 0.1) {
      list.push({ employeeId, day, checkIn: null, checkOut: null, statusOverride: 'leave' });
      continue;
    }

    const hour = 8 + Math.floor(r1 * 2);
    const minute = Math.floor(r2 * 60);
    const checkIn = `${pad(hour)}:${pad(minute)}`;
    const outHour = 18 + (r2 > 0.6 ? 1 : 0);
    const outMinute = Math.floor(seededRand(dayIndex + 13) * 60);
    const checkOut = `${pad(outHour)}:${pad(outMinute)}`;

    list.push({ employeeId, day, checkIn, checkOut, statusOverride: null });
  }
  return list;
}

async function insertPunches(conn: PoolConnection, rows: SeedPunch[]): Promise<void> {
  const chunkSize = 200;
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, NULL, 'seed', NULL, NOW(), NOW())").join(',');
    const params: unknown[] = [];
    chunk.forEach((row) => {
      params.push(row.employeeId, row.day, row.checkIn, row.checkOut, row.statusOverride);
    });
    await conn.query(
      `INSERT INTO attendance_punches
        (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         check_in = VALUES(check_in), check_out = VALUES(check_out),
         status_override = VALUES(status_override), note = NULL, source = 'seed',
         updated_by_admin_id = NULL, updated_at = NOW()`,
      params
    );
  }
}

/** 为指定员工生成最近 N 天的演示考勤（不含今天） */
export async function seedAttendanceForEmployees(employeeIds: string[], days = 60): Promise<void> {
  if (!employeeIds.length) return;
  const rows = employeeIds.flatMap((id) => buildSeedPunches(id, days));
  await transaction(async (conn) => {
    await insertPunches(conn, rows);
  });
}

/** 为演示账号生成今天的上班卡（不生成下班卡，保留「进行中」的观感） */
export async function seedTodayCheckIns(employeeIds: string[], excludeIds: string[] = ['U001']): Promise<void> {
  const now = new Date();
  if (!isWorkday(now)) return;
  const today = dateKey(now);
  const dayIndex = Math.floor(parseDateKey(today).getTime() / 86400000);
  const rows: Array<{ employeeId: string; checkIn: string }> = [];

  for (const employeeId of employeeIds) {
    if (excludeIds.includes(employeeId)) continue;
    const hash = employeeId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    if (seededRand(dayIndex + hash) < 0.08) continue; // 少量员工今天未打卡

    const base = 8 * 60 + Math.floor(seededRand(dayIndex + hash + 31) * 100);
    const hour = Math.floor(base / 60);
    const minute = base % 60;
    rows.push({ employeeId, checkIn: `${pad(hour)}:${pad(minute)}` });
  }

  if (!rows.length) return;
  await transaction(async (conn) => {
    const chunkSize = 200;
    for (let start = 0; start < rows.length; start += chunkSize) {
      const chunk = rows.slice(start, start + chunkSize);
      const placeholders = chunk.map(() => "(?, ?, ?, NULL, NULL, NULL, 'seed', NULL, NOW(), NOW())").join(',');
      const params: unknown[] = [];
      chunk.forEach((row) => params.push(row.employeeId, today, row.checkIn));
      await conn.query(
        `INSERT IGNORE INTO attendance_punches
          (employee_id, punch_date, check_in, check_out, status_override, note, source, updated_by_admin_id, created_at, updated_at)
         VALUES ${placeholders}`,
        params
      );
    }
  });
}
