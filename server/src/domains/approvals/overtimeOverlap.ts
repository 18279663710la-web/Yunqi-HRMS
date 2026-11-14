const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

interface ClockFields { date?: string; startTime?: string; endTime?: string }

function only(form: Array<{ label?: string; value?: string }>, label: string): string | undefined {
  const matches = form.filter(item => item?.label === label);
  return matches.length === 1 ? String(matches[0].value ?? '') : undefined;
}

/** 同一天且结束晚于开始时返回可比较的分钟区间。跨日申请不在此处理。 */
export function overtimeInterval(input: ClockFields | Array<{ label: string; value: string }>): { start: string; end: string } | null {
  const fields: ClockFields = Array.isArray(input)
    ? { date: only(input, '加班日期'), startTime: only(input, '开始时间'), endTime: only(input, '结束时间') }
    : input;
  const date = fields.date?.trim() ?? '';
  const startTime = fields.startTime?.trim() ?? '';
  const endTime = fields.endTime?.trim() ?? '';
  if (!DATE.test(date) || !CLOCK.test(startTime) || !CLOCK.test(endTime) || endTime <= startTime) return null;
  return { start: `${date} ${startTime}`, end: `${date} ${endTime}` };
}

/** 待审批交叉提示先撤回；只有已通过的交叉才提示已通过。驳回、撤销和首尾相接不拦截。 */
export function overtimeConflictMessage(current: { start: string; end: string }, rows: Array<{ status: string; form: unknown }>): string | null {
  let pending = false;
  let approved = false;
  for (const row of rows) {
    if (!Array.isArray(row.form)) continue;
    const other = overtimeInterval(row.form);
    if (!other || !(current.start < other.end && other.start < current.end)) continue;
    if (row.status === 'pending') pending = true;
    else if (row.status === 'approved') approved = true;
  }
  if (pending) return '该时段与待审批的加班申请交叉，请先撤回后再提交';
  if (approved) return '该时段与已通过的加班申请交叉';
  return null;
}
