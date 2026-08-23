"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  pointerWithin,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChatSidebar } from "@/components/ChatSidebar";
import { KanbanColumn } from "@/components/KanbanColumn";
import { KanbanCardPreview } from "@/components/KanbanCardPreview";
import {
  createCard,
  deleteCardRemote,
  fetchBoard,
  moveCardRemote,
  renameColumn,
  SessionExpiredError,
} from "@/lib/api";
import { moveCard, type BoardData } from "@/lib/kanban";

type KanbanBoardProps = {
  username: string;
  onLogout: () => void;
};

export const KanbanBoard = ({ username, onLogout }: KanbanBoardProps) => {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const load = useCallback(() => {
    fetchBoard()
      .then((data) => {
        setBoard(data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof SessionExpiredError) {
          onLogout();
          return;
        }
        setLoadError("Couldn't load the board. Please try again.");
      });
  }, [onLogout]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMutationError = (error: unknown) => {
    if (error instanceof SessionExpiredError) {
      onLogout();
      return;
    }
    setApiError("Something went wrong saving that change. Reloading the board.");
    load();
  };

  const cardsById = useMemo(() => board?.cards ?? {}, [board]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveCardId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCardId(null);

    if (!over || active.id === over.id || !board) {
      return;
    }

    const activeId = active.id as string;
    const nextColumns = moveCard(board.columns, activeId, over.id as string);
    const targetColumn = nextColumns.find((column) =>
      column.cardIds.includes(activeId)
    );
    if (!targetColumn) {
      return;
    }
    const targetPosition = targetColumn.cardIds.indexOf(activeId);

    setBoard((prev) => (prev ? { ...prev, columns: nextColumns } : prev));
    moveCardRemote(activeId, targetColumn.id, targetPosition).catch(
      handleMutationError
    );
  };

  const handleTitleChange = (columnId: string, title: string) => {
    setBoard((prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((column) =>
              column.id === columnId ? { ...column, title } : column
            ),
          }
        : prev
    );
  };

  const handleTitleCommit = (columnId: string, title: string) => {
    renameColumn(columnId, title).catch(handleMutationError);
  };

  const handleAddCard = (columnId: string, title: string, details: string) => {
    createCard(columnId, title, details || "No details yet.")
      .then((card) => {
        setBoard((prev) =>
          prev
            ? {
                ...prev,
                cards: { ...prev.cards, [card.id]: card },
                columns: prev.columns.map((column) =>
                  column.id === columnId
                    ? { ...column, cardIds: [...column.cardIds, card.id] }
                    : column
                ),
              }
            : prev
        );
      })
      .catch(handleMutationError);
  };

  const handleDeleteCard = (columnId: string, cardId: string) => {
    setBoard((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        cards: Object.fromEntries(
          Object.entries(prev.cards).filter(([id]) => id !== cardId)
        ),
        columns: prev.columns.map((column) =>
          column.id === columnId
            ? { ...column, cardIds: column.cardIds.filter((id) => id !== cardId) }
            : column
        ),
      };
    });
    deleteCardRemote(cardId).catch(handleMutationError);
  };

  const activeCard = activeCardId ? cardsById[activeCardId] : null;

  if (loadError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-[var(--gray-text)]">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Retry
        </button>
      </main>
    );
  }

  if (!board) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-[var(--gray-text)]">Loading board...</p>
      </main>
    );
  }

  // closestCorners compares every droppable rect globally (columns AND
  // every card in every column), with no notion of "this card is nested
  // inside that column" - a card's corner in an adjacent column can end up
  // geometrically closer than the column/card actually under the pointer,
  // which is what caused cards to intermittently land in the wrong lane or
  // snap back to their start. This two-phase strategy (the pattern dnd-kit
  // itself documents for multi-container sortable boards) first finds which
  // column the pointer is actually within, then - only among that column's
  // own cards - finds the closest one by center distance, so the result is
  // always "the lane the pointer is over" and, within it, "the nearest
  // card," never a card from a different lane.
  const collisionDetectionStrategy: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    const collisions =
      pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);
    const overId = getFirstCollision(collisions, "id");
    if (overId == null) {
      return [];
    }

    const column = board.columns.find((candidate) => candidate.id === overId);
    if (!column || column.cardIds.length === 0) {
      return [{ id: overId }];
    }

    // Dropping below the last card's own rect means "append to the end of
    // this column," not "insert before whichever card is nearest." Without
    // this check there's no explicit "end of list" target - closestCenter
    // always resolves to *some* card - so dropping in the empty space below
    // the last card would insert just above it instead of after it.
    const pointerY = args.pointerCoordinates?.y;
    if (pointerY != null) {
      const lastCardId = column.cardIds[column.cardIds.length - 1];
      const lastCardRect = args.droppableRects.get(lastCardId);
      if (lastCardRect && pointerY > lastCardRect.bottom) {
        return [{ id: overId }];
      }
    }

    const cardCollisions = closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) =>
        column.cardIds.includes(container.id as string)
      ),
    });
    return cardCollisions.length > 0 ? cardCollisions : [{ id: overId }];
  };

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1700px] flex-col gap-10 px-6 pb-16 pt-12 2xl:flex-row 2xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-10">
          <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
                Signed in as {username}
              </span>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]"
              >
                Log out
              </button>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                  Single Board Kanban
                </p>
                <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                  Kanban Studio
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                  Keep momentum visible. Rename columns, drag cards between stages,
                  and capture quick notes without getting buried in settings.
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[var(--gray-text)]">
                  Focus
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--primary-blue)]">
                  One board. Five columns. Zero clutter.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {board.columns.map((column) => (
                <div
                  key={column.id}
                  className="flex items-center gap-2 rounded-full border border-[var(--stroke)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--navy-dark)]"
                >
                  <span className="h-2 w-2 rounded-full bg-[var(--accent-yellow)]" />
                  {column.title}
                </div>
              ))}
            </div>
          </header>

          {apiError && (
            <p
              role="alert"
              className="rounded-2xl border border-[var(--stroke)] bg-white/80 px-5 py-3 text-sm text-red-600"
            >
              {apiError}
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <section className="grid gap-6 lg:grid-cols-5">
              {board.columns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  column={column}
                  cards={column.cardIds.map((cardId) => board.cards[cardId])}
                  onTitleChange={handleTitleChange}
                  onTitleCommit={handleTitleCommit}
                  onAddCard={handleAddCard}
                  onDeleteCard={handleDeleteCard}
                />
              ))}
            </section>
            <DragOverlay>
              {activeCard ? (
                <div className="w-[260px]">
                  <KanbanCardPreview card={activeCard} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        <ChatSidebar
          onBoardUpdate={(nextBoard) => setBoard(nextBoard)}
          onSessionExpired={onLogout}
        />
      </main>
    </div>
  );
};
