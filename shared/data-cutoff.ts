export type DataPeriodType = "daily" | "weekly" | "monthly";

export const DATA_CUTOFF_LOCAL_DATE = "2026-05-01";
export const DATA_CUTOFF_INSTANT = "2026-04-30T15:00:00.000Z";
export const DATA_CUTOFF_MS = Date.parse(DATA_CUTOFF_INSTANT);

const earliestPeriodKeys: Record<DataPeriodType, string> = {
  daily: "2026-05-01",
  weekly: "2026-04-26",
  monthly: "2026-05",
};

export function dataCutoffPeriodKey(type: DataPeriodType): string {
  return earliestPeriodKeys[type];
}

export function clampPeriodKeyToDataCutoff(
  type: DataPeriodType,
  key: string,
): string {
  const cutoffKey = dataCutoffPeriodKey(type);
  return key < cutoffKey ? cutoffKey : key;
}

export function isPeriodKeyBeforeDataCutoff(
  type: DataPeriodType,
  key: string,
): boolean {
  return key < dataCutoffPeriodKey(type);
}

export function clampInstantToDataCutoff(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || timestamp < DATA_CUTOFF_MS) {
    return DATA_CUTOFF_INSTANT;
  }
  return new Date(timestamp).toISOString();
}
