# Scripts

Start/stop scripts for the Dockerized app. `.sh` for Mac/Linux, `.ps1` for
Windows. All read secrets (`OPENROUTER_API_KEY`) from the `.env` file at the
project root via `docker run --env-file`.

- `start.sh` / `start.ps1` - `docker build` the root `Dockerfile` (tag
  `pm-app`), remove any existing `pm-app` container, run a new one detached
  on port 8000. Mounts `./backend/data` (created if missing) to
  `/app/backend/data` in the container, so the SQLite database survives
  `docker rm`/recreate - without this mount, every restart would silently
  wipe the Kanban board back to its seed data, since `start.*` always
  removes and recreates the container rather than reusing it.
- `stop.sh` / `stop.ps1` - stop and remove the `pm-app` container. Database
  is untouched (lives in the host-mounted `backend/data/`, not in the
  container).

## Running

Mac/Linux:
```
./scripts/start.sh
./scripts/stop.sh
```

Windows (PowerShell):
```
scripts\start.ps1
scripts\stop.ps1
```

App is available at http://localhost:8000 once started.
