export interface HistoryEntry {
  id: number;
  command: string;
  paneId?: string;
  paneType?: string;
  exitCode?: number;
  durationMs?: number;
  executedAt: string; // ISO timestamp from chrono
  isFavorite: boolean;
}

export interface NewHistoryEntry {
  command: string;
  paneId?: string;
  paneType?: string;
  exitCode?: number;
  durationMs?: number;
}

export interface HistoryQuery {
  text?: string;
  paneId?: string;
  limit?: number;
  favoritesOnly?: boolean;
}
