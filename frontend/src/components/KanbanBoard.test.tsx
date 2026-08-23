import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import * as api from "@/lib/api";
import { initialData } from "@/lib/kanban";

vi.mock("@/lib/api");
const mockedApi = vi.mocked(api);

const cloneBoard = () => structuredClone(initialData);

describe("KanbanBoard", () => {
  beforeEach(() => {
    mockedApi.fetchBoard.mockResolvedValue(cloneBoard());
    mockedApi.renameColumn.mockResolvedValue({
      id: "col-backlog",
      title: "New Name",
      cardIds: [],
    });
    mockedApi.createCard.mockImplementation((columnId, title, details) =>
      Promise.resolve({ id: "card-new", title, details })
    );
    mockedApi.moveCardRemote.mockResolvedValue({
      id: "card-1",
      title: "x",
      details: "x",
    });
    mockedApi.deleteCardRemote.mockResolvedValue(undefined);
  });

  it("shows a loading state, then renders five columns", async () => {
    render(<KanbanBoard username="user" onLogout={() => {}} />);
    expect(screen.getByText(/loading board/i)).toBeInTheDocument();
    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("shows a retry button when the board fails to load", async () => {
    mockedApi.fetchBoard.mockReset();
    mockedApi.fetchBoard.mockRejectedValueOnce(new Error("network down"));
    mockedApi.fetchBoard.mockResolvedValueOnce(cloneBoard());
    render(<KanbanBoard username="user" onLogout={() => {}} />);

    const retryButton = await screen.findByRole("button", { name: /retry/i });
    await userEvent.click(retryButton);

    expect(await screen.findAllByTestId(/column-/i)).toHaveLength(5);
  });

  it("logs out when the board fetch reports an expired session", async () => {
    mockedApi.fetchBoard.mockReset();
    mockedApi.fetchBoard.mockRejectedValue(new api.SessionExpiredError());
    const onLogout = vi.fn();
    render(<KanbanBoard username="user" onLogout={onLogout} />);

    await screen.findByText(/loading board/i);
    await vi.waitFor(() => expect(onLogout).toHaveBeenCalled());
  });

  it("renames a column on blur, not on every keystroke", async () => {
    render(<KanbanBoard username="user" onLogout={() => {}} />);
    const column = await screen.findAllByTestId(/column-/i).then((c) => c[0]);
    const input = within(column).getByLabelText("Column title");

    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
    expect(mockedApi.renameColumn).not.toHaveBeenCalled();

    input.blur();
    await vi.waitFor(() =>
      expect(mockedApi.renameColumn).toHaveBeenCalledWith("col-backlog", "New Name")
    );
  });

  it("adds and removes a card, calling the backend", async () => {
    render(<KanbanBoard username="user" onLogout={() => {}} />);
    const column = await screen.findAllByTestId(/column-/i).then((c) => c[0]);
    const addButton = within(column).getByRole("button", {
      name: /add a card/i,
    });
    await userEvent.click(addButton);

    const titleInput = within(column).getByPlaceholderText(/card title/i);
    await userEvent.type(titleInput, "New card");
    const detailsInput = within(column).getByPlaceholderText(/details/i);
    await userEvent.type(detailsInput, "Notes");

    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(await within(column).findByText("New card")).toBeInTheDocument();
    expect(mockedApi.createCard).toHaveBeenCalledWith(
      "col-backlog",
      "New card",
      "Notes"
    );

    const deleteButton = within(column).getByRole("button", {
      name: /delete new card/i,
    });
    await userEvent.click(deleteButton);

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    expect(mockedApi.deleteCardRemote).toHaveBeenCalledWith("card-new");
  });
});
