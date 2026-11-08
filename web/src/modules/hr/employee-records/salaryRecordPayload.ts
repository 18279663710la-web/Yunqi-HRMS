export function salaryRecordPayload(data: Record<string, unknown>, modelVersion: number): Record<string, unknown> {
  const { jobTitle: _jobTitle, ...salary } = data;
  return { ...salary, modelVersion };
}
