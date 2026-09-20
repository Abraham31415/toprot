export function isStalled(lastActivity: Date, thresholdDays: number): boolean {
  const msSinceActivity = Date.now() - lastActivity.getTime();
  return msSinceActivity > thresholdDays * 24 * 60 * 60 * 1000;
}

export function latestOf(...dates: (string | null | undefined)[]): Date {
  const timestamps = dates.filter((d): d is string => !!d).map((d) => new Date(d).getTime());
  return new Date(timestamps.length ? Math.max(...timestamps) : 0);
}
