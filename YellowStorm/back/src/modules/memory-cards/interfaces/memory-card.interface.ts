export interface MemoryCardResponse {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: string;
  keywords: string[];
  valid_from: string | null;
  valid_until: string | null;
  created_at: string | null;
  updated_at: string | null;
}
