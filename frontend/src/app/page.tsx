"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";
import { getSession, login, logout, type Session } from "@/lib/auth";

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    getSession()
      .then(setSession)
      .finally(() => setIsChecking(false));
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setSession(await login(username, password));
  };

  const handleLogout = async () => {
    await logout();
    setSession(null);
  };

  if (isChecking) {
    return null;
  }

  if (!session) {
    return <LoginForm onLogin={handleLogin} />;
  }

  return <KanbanBoard username={session.username} onLogout={handleLogout} />;
}
