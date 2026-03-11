# Coderefine – AI Code Refinement Workbench

Coderefine is a web-based tool that helps you **refine, understand, and improve code** using an AI assistant powered by **Groq**. It supports major languages (Python, JavaScript, Java, C, C++, Rust, etc.), provides a modern code editor, and offers an integrated chat to answer questions about your code.

The project is split into:

- `backend` – Python FastAPI service that talks to Groq and Supabase.
- `frontend` – HTML/CSS/JS single-page web app with a CodeMirror editor and AI chat panel.

---

## Prerequisites

- Python 3.10+
- Node is *not* required (frontend is plain HTML/CSS/JS).
- A Groq API key
- (Optional) Supabase project URL and anon key, plus tables:
  - `refinements` with columns: `id`, `language`, `original_code`, `refined_code`, `summary`, `created_at`.
  - `chats` with columns: `id`, `language`, `code_context`, `messages` (JSON), `reply`, `created_at`.

---

## Backend setup (FastAPI + Groq + Supabase)

1. Open a terminal in the `backend` folder:

   ```bash
   cd backend
   ```

2. Create and activate a virtual environment (recommended):

   ```bash
   python -m venv .venv
   .venv\Scripts\activate  # On Windows
   ```

3. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

4. Set environment variables (PowerShell examples):

   ```powershell
   $env:GROQ_API_KEY = "your_groq_api_key_here"
   $env:SUPABASE_URL = "https://your-project.supabase.co"
   $env:SUPABASE_ANON_KEY = "your_supabase_anon_key"
   ```

   Supabase variables are optional. If they are not set, Coderefine will still work, but refinements and chats will not be persisted.

5. Run the backend:

   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

6. Verify it is healthy by opening:

   - `http://localhost:8000/health`

---

## Frontend setup (Codemirror-based web UI)

1. Open the `frontend` folder in your editor.
2. You can serve `index.html` using any static server, or simply open it directly in your browser:

   - Option A (recommended): use `python -m http.server` from the project root or `frontend` folder.

     ```bash
     cd frontend
     python -m http.server 5173
     ```

     Then open `http://localhost:5173` in your browser.

   - Option B: double-click `index.html` and open it directly. Some browsers may block cross-origin calls when opened as a `file://` URL, so a local HTTP server is usually more reliable.

3. Make sure the backend is running at `http://localhost:8000` (this is what the frontend expects by default; you can change `API_BASE` in `frontend/main.js` if needed).

---

## Key features

- **Full-screen layout**: Sidebar navigation, top command bar, main editor, and a right-side AI assistant panel so the full screen is used efficiently.
- **Code editor**:
  - Powered by CodeMirror with line numbers and syntax highlighting.
  - Supports Python, JavaScript, Java, C, C++, Rust (and falls back gracefully for others).
  - Quick metrics strip (line count and rough complexity heuristic).
- **Theme system**:
  - Midnight (dark, blue/purple accents),
  - Cloud (light),
  - Nebula (purple-focused).
- **AI refinement**:
  - Send the current code and goal (readability, performance, production hardening, documentation) to the backend.
  - Backend calls Groq (`llama-3.3-70b-versatile`) to generate refined code and a short explanation + suggestions.
  - Suggestions are displayed in an “Insights” panel.
- **AI chat assistant**:
  - Floating 🤖 icon next to the editor to open/close the assistant on small screens.
  - Ask questions about the code in the editor; responses are powered by Groq.
- **Persistence**:
  - Local: save/load your latest snippet to/from `localStorage` with one click.
  - Remote (optional): if Supabase is configured, refinements and chat sessions are also stored in the `refinements` and `chats` tables.

---

## Customization ideas

- Wire the “History” and “Playground” nav items to real views powered by Supabase history.
- Replace the placeholder diff behavior with a real side‑by‑side diff viewer.
- Add per-language formatting via external tools (e.g., Black for Python, Prettier for JS) by extending the backend.
- Hook up authentication (via Supabase Auth) so refinements are per-user.

---

## Notes

- This project is intentionally minimal in tooling (no build step) so you can explore and extend it easily.
- If you change the backend port or host, update `API_BASE` in `frontend/main.js`.

