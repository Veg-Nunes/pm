import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import * as api from "@/lib/api";
import { initialData } from "@/lib/kanban";

vi.mock("@/lib/api");
const mockedApi = vi.mocked(api);

describe("ChatSidebar", () => {
  const send = async (message: string) => {
    const input = screen.getByLabelText("Chat message");
    await userEvent.type(input, message);
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
  };

  it("sends the message with the prior history and shows the reply", async () => {
    mockedApi.sendChatMessage.mockResolvedValue({
      reply: "Sure, done!",
      boardUpdate: null,
    });
    const onBoardUpdate = vi.fn();
    render(
      <ChatSidebar onBoardUpdate={onBoardUpdate} onSessionExpired={() => {}} />
    );

    await send("add a card");

    expect(mockedApi.sendChatMessage).toHaveBeenCalledWith("add a card", []);
    expect(await screen.findByText("Sure, done!")).toBeInTheDocument();
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("includes prior turns as history on the next message", async () => {
    mockedApi.sendChatMessage.mockResolvedValue({
      reply: "First reply",
      boardUpdate: null,
    });
    render(<ChatSidebar onBoardUpdate={() => {}} onSessionExpired={() => {}} />);

    await send("first message");
    await screen.findByText("First reply");

    mockedApi.sendChatMessage.mockResolvedValue({
      reply: "Second reply",
      boardUpdate: null,
    });
    await send("second message");

    expect(mockedApi.sendChatMessage).toHaveBeenLastCalledWith("second message", [
      { role: "user", content: "first message" },
      { role: "assistant", content: "First reply" },
    ]);
  });

  it("shows a loading indicator while awaiting the response", async () => {
    let resolvePromise: (value: api.ChatResult) => void = () => {};
    mockedApi.sendChatMessage.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );
    render(<ChatSidebar onBoardUpdate={() => {}} onSessionExpired={() => {}} />);

    await send("hello");
    expect(screen.getByRole("status")).toBeInTheDocument();

    resolvePromise({ reply: "done", boardUpdate: null });
    await screen.findByText("done");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("applies a board update returned by the assistant", async () => {
    const board = structuredClone(initialData);
    mockedApi.sendChatMessage.mockResolvedValue({
      reply: "Added it.",
      boardUpdate: board,
    });
    const onBoardUpdate = vi.fn();
    render(
      <ChatSidebar onBoardUpdate={onBoardUpdate} onSessionExpired={() => {}} />
    );

    await send("add a card called X to Backlog");

    await screen.findByText("Added it.");
    expect(onBoardUpdate).toHaveBeenCalledWith(board);
  });

  it("logs out when the chat request reports an expired session", async () => {
    mockedApi.sendChatMessage.mockRejectedValue(new api.SessionExpiredError());
    const onSessionExpired = vi.fn();
    render(
      <ChatSidebar onBoardUpdate={() => {}} onSessionExpired={onSessionExpired} />
    );

    await send("hello");

    await vi.waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });

  it("shows an error message if the request fails", async () => {
    mockedApi.sendChatMessage.mockRejectedValue(new Error("network down"));
    render(<ChatSidebar onBoardUpdate={() => {}} onSessionExpired={() => {}} />);

    await send("hello");

    expect(await screen.findByRole("alert")).toHaveTextContent(/didn't respond/i);
  });
});
