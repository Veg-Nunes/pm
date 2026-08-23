import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import * as auth from "@/lib/auth";
import * as api from "@/lib/api";
import { initialData } from "@/lib/kanban";

vi.mock("@/lib/auth");
vi.mock("@/lib/api");
const mockedAuth = vi.mocked(auth);
const mockedApi = vi.mocked(api);

describe("Home", () => {
  beforeEach(() => {
    mockedApi.fetchBoard.mockResolvedValue(structuredClone(initialData));
  });

  it("shows the login form when there is no session", async () => {
    mockedAuth.getSession.mockResolvedValue(null);
    render(<Home />);

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("shows the kanban board when a session already exists", async () => {
    mockedAuth.getSession.mockResolvedValue({ username: "user" });
    render(<Home />);

    expect(
      await screen.findByRole("heading", { name: /kanban studio/i })
    ).toBeInTheDocument();
    expect(screen.getByText("Signed in as user")).toBeInTheDocument();
  });

  it("shows the board after a successful login", async () => {
    mockedAuth.getSession.mockResolvedValue(null);
    mockedAuth.login.mockResolvedValue({ username: "user" });
    render(<Home />);

    await userEvent.type(await screen.findByLabelText("Username"), "user");
    await userEvent.type(screen.getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("heading", { name: /kanban studio/i })
    ).toBeInTheDocument();
  });

  it("returns to the login form after logout", async () => {
    mockedAuth.getSession.mockResolvedValue({ username: "user" });
    mockedAuth.logout.mockResolvedValue(undefined);
    render(<Home />);

    await userEvent.click(
      await screen.findByRole("button", { name: /log out/i })
    );

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });
});
