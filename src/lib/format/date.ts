/** Timestamp formatting — Asia/Jakarta, id-ID (project tz). */

const jakartaDateTime = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "short",
});

const jakartaDate = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
});

/** "13 Sep 2025 pukul 14.05" — for order messages. */
export function formatJakartaDateTime(date: Date = new Date()): string {
  return jakartaDateTime.format(date);
}

export function formatJakartaDate(date: Date = new Date()): string {
  return jakartaDate.format(date);
}

/** "13 Sep 2025, 14.05 WIB" — for diagnostics and sync panels. */
export function formatWib(date: Date = new Date()): string {
  return `${jakartaDateTime.format(date)} WIB`;
}
