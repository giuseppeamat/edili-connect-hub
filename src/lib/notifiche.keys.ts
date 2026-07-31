/**
 * Sprint 8 — Query keys centralizzate del modulo Notifiche.
 * Nessuna invalidazione globale.
 */
export type NotificheFilters = {
  stato?: "non_lette" | "tutte" | "archiviate" | null;
  tipo?: string | null;
  severita?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

export const notificheKeys = {
  all: ["notifiche"] as const,
  lists: () => [...notificheKeys.all, "list"] as const,
  list: (f?: NotificheFilters) => [...notificheKeys.lists(), f ?? {}] as const,
  unreadCount: () => [...notificheKeys.all, "unread-count"] as const,
  preview: () => [...notificheKeys.all, "preview"] as const,
  archived: () => [...notificheKeys.all, "list", { stato: "archiviate" }] as const,
};

export function invalidateNotifiche(qc: {
  invalidateQueries: (o: { queryKey: readonly unknown[] }) => unknown;
}) {
  qc.invalidateQueries({ queryKey: notificheKeys.lists() });
  qc.invalidateQueries({ queryKey: notificheKeys.unreadCount() });
  qc.invalidateQueries({ queryKey: notificheKeys.preview() });
}
