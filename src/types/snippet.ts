export interface Snippet {
  id: number;
  name: string;
  command: string;
  description: string | null;
  shortcut: string | null;
}

export interface NewSnippet {
  name: string;
  command: string;
  description?: string | null;
  shortcut?: string | null;
}
