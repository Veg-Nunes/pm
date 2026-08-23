export type Session = {
  username: string;
};

export const login = async (
  username: string,
  password: string
): Promise<Session> => {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username, password }),
  });

  if (!response.ok) {
    throw new Error("Invalid username or password.");
  }

  return response.json();
};

export const logout = async (): Promise<void> => {
  await fetch("/api/logout", { method: "POST", credentials: "include" });
};

export const getSession = async (): Promise<Session | null> => {
  const response = await fetch("/api/me", { credentials: "include" });
  if (!response.ok) {
    return null;
  }
  return response.json();
};
