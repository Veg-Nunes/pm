import type { BoardData, Card, Column } from "@/lib/kanban";

export class SessionExpiredError extends Error {}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (response.status === 401) {
    throw new SessionExpiredError();
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed (${response.status})`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json();
};

export const fetchBoard = () => request<BoardData>("/api/board");

export const renameColumn = (columnId: string, title: string) =>
  request<Column>(`/api/columns/${columnId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });

export const createCard = (columnId: string, title: string, details: string) =>
  request<Card>("/api/cards", {
    method: "POST",
    body: JSON.stringify({ column_id: columnId, title, details }),
  });

export const moveCardRemote = (
  cardId: string,
  columnId: string,
  position: number
) =>
  request<Card>(`/api/cards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify({ column_id: columnId, position }),
  });

export const deleteCardRemote = (cardId: string) =>
  request<void>(`/api/cards/${cardId}`, { method: "DELETE" });

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResult = {
  reply: string;
  boardUpdate: BoardData | null;
};

export const sendChatMessage = (message: string, history: ChatMessage[]) =>
  request<ChatResult>("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message, history }),
  });
