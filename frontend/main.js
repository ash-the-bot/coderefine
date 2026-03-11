/* ──────────────────────────────────────────────────────────────
   Coderefine Studio — main.js
   ────────────────────────────────────────────────────────────── */

const FRONTEND_CONFIG = window.CODEREFINE_CONFIG || {};
const API_BASE        = FRONTEND_CONFIG.API_BASE         || "http://localhost:8000";
const SUPABASE_URL    = FRONTEND_CONFIG.SUPABASE_URL     || "";
const SUPABASE_ANON_KEY = FRONTEND_CONFIG.SUPABASE_ANON_KEY || "";

let editor          = null;
let currentLanguage = "python";
let monacoReady     = false;
let domReady        = false;
let appStarted      = false;
let supabaseClient  = null;
let authReady       = false;

/* ── LANGUAGE HELPERS ──────────────────────────────────────── */
const LANG_EXT = {
  python: "py", javascript: "js", java: "java",
  c: "c", cpp: "cpp", rust: "rs",
};

const LANG_MONACO = {
  python: "python", javascript: "javascript", java: "java",
  c: "c", cpp: "cpp", rust: "cpp",   // Monaco has no Rust built-in
};

function updateFileNameBadge() {
  const badge = document.getElementById("file-name-badge");
  if (badge) badge.textContent = `scratch.${LANG_EXT[currentLanguage] || currentLanguage}`;
}

function languageToMonaco(lang) {
  return LANG_MONACO[lang] || "plaintext";
}

/* ── METRICS ───────────────────────────────────────────────── */
function estimateComplexity(code) {
  const matches = code.match(/(if|for|while|case|catch|elif|&&|\|\|)/g);
  return matches ? matches.length : 0;
}

function updateMetrics() {
  if (!editor) return;
  const code  = editor.getValue();
  const lines  = code.split("\n").length;
  const chars  = code.length;
  const cx     = estimateComplexity(code);

  animateCounter("metric-lines", lines);
  animateCounter("metric-chars", chars);

  const cxEl = document.getElementById("metric-complexity");
  if (cxEl) {
    cxEl.textContent = cx;
    cxEl.setAttribute("data-complexity",
      cx === 0 ? "" : cx < 5 ? "low" : cx < 15 ? "medium" : "high"
    );
  }
  document.getElementById("metric-language").textContent =
    currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
}

let counterTimers = {};
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent, 10) || 0;
  if (current === target) return;
  clearTimeout(counterTimers[id]);
  const step   = Math.ceil(Math.abs(target - current) / 8);
  const dir    = target > current ? 1 : -1;
  let val      = current;
  function tick() {
    val = Math.min(Math.max(val + dir * step, 0), target);
    if (dir === -1) val = Math.max(val, target);
    el.textContent = val;
    if (val !== target) counterTimers[id] = setTimeout(tick, 16);
  }
  tick();
}

/* ── STATUS ────────────────────────────────────────────────── */
function setStatus(text, active = false) {
  const el = document.getElementById("status-indicator");
  if (!el) return;
  el.textContent = text;
  el.setAttribute("data-active", active ? "true" : "false");
}

/* ── BACKEND PING ──────────────────────────────────────────── */
async function pingBackend() {
  const pill = document.getElementById("backend-status");
  if (!pill) return;
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error("Health check failed");
    pill.textContent = "Online";
    pill.className = "pill pill-success";
  } catch {
    pill.textContent = "Offline";
    pill.className = "pill pill-danger";
  }
}

/* ── THEME SWITCHER ────────────────────────────────────────── */
function initThemeSwitcher() {
  const html  = document.documentElement;
  const pills = document.querySelectorAll(".theme-pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const choice = pill.getAttribute("data-theme-choice");
      html.setAttribute("data-theme", choice);

      // Sync Monaco theme
      if (window.monaco) {
        const monacoTheme = choice === "light" ? "vs" : "vs-dark";
        monaco.editor.setTheme(monacoTheme);
      }

      pills.forEach((p) => p.classList.remove("theme-pill-active"));
      pill.classList.add("theme-pill-active");
    });
  });
}

/* ── EDITOR ────────────────────────────────────────────────── */
function initEditor() {
  const container = document.getElementById("editor-container");
  editor = monaco.editor.create(container, {
    value:               "# Paste or type code here to refine it.\n\n",
    language:            languageToMonaco(currentLanguage),
    theme:               "vs-dark",
    automaticLayout:     true,
    fontSize:            13.5,
    fontFamily:          "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace",
    fontLigatures:       true,
    lineHeight:          22,
    minimap:             { enabled: false },
    scrollBeyondLastLine: false,
    padding:             { top: 16, bottom: 16 },
    renderLineHighlight: "gutter",
    smoothScrolling:     true,
    cursorBlinking:      "smooth",
    cursorSmoothCaretAnimation: "on",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
    "semanticHighlighting.enabled": true,
    scrollbar: {
      useShadows: false,
      verticalScrollbarSize: 5,
      horizontalScrollbarSize: 5,
    },
  });

  editor.onDidChangeModelContent(updateMetrics);
  updateMetrics();
}

function initLanguageSelect() {
  const select = document.getElementById("language-select");
  select.addEventListener("change", () => {
    currentLanguage = select.value;
    if (editor && window.monaco) {
      monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(currentLanguage));
    }
    updateFileNameBadge();
    document.getElementById("metric-language").textContent =
      currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
  });
}

/* ── AUTH ──────────────────────────────────────────────────── */
function showAppShell() {
  const authRoot = document.getElementById("auth-root");
  const appRoot  = document.getElementById("app-root");
  if (authRoot) authRoot.style.display = "none";
  if (appRoot)  appRoot.style.display  = "grid";
}

function showAuthShell() {
  const authRoot = document.getElementById("auth-root");
  const appRoot  = document.getElementById("app-root");
  if (appRoot)  appRoot.style.display  = "none";
  if (authRoot) authRoot.style.display = "flex";
}

function initAuth() {
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showAppShell();
    authReady = true;
    if (monacoReady && domReady && !appStarted) startApp();
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const emailForm    = document.getElementById("auth-email-form");
  const emailInput   = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");
  const errorBox     = document.getElementById("auth-error");
  const googleBtn    = document.getElementById("btn-login-google");
  const githubBtn    = document.getElementById("btn-login-github");

  async function updateFromSession() {
    const { data } = await supabaseClient.auth.getSession();
    if (data && data.session) {
      showAppShell();
      authReady = true;
      if (monacoReady && domReady && !appStarted) startApp();
    } else {
      showAuthShell();
    }
  }

  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.textContent = "";
    const email    = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return;

    const submitBtn = emailForm.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    const { error: signInError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (signInError) {
      const { error: signUpError } = await supabaseClient.auth.signUp({ email, password });
      if (signUpError) {
        errorBox.textContent = signUpError.message || "Unable to sign in.";
      } else {
        errorBox.textContent = "Check your email to confirm your account, then sign in.";
      }
    }
    submitBtn.disabled  = false;
    submitBtn.textContent = "Continue →";
    await updateFromSession();
  });

  async function signInWithProvider(provider) {
    errorBox.textContent = "";
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
    if (error) {
      errorBox.textContent = error.message || `Unable to sign in with ${provider}.`;
    }
  }

  googleBtn.addEventListener("click", () => signInWithProvider("google"));
  githubBtn.addEventListener("click", () => signInWithProvider("github"));

  updateFromSession();
}

/* ── CHAT ──────────────────────────────────────────────────── */
function appendChatBubble(role, content) {
  const thread  = document.getElementById("chat-thread");
  const wrapper = document.createElement("div");
  wrapper.className = "chat-message " + (role === "user" ? "chat-message-user" : "chat-message-system");

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "You" : "CR";

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = content;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  thread.appendChild(wrapper);

  // Smooth scroll
  requestAnimationFrame(() => {
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  });
}

function appendTypingIndicator() {
  const thread  = document.getElementById("chat-thread");
  const wrapper = document.createElement("div");
  wrapper.id = "typing-indicator";
  wrapper.className = "chat-message chat-message-system";
  wrapper.innerHTML = `
    <div class="chat-avatar">CR</div>
    <div class="chat-bubble" style="display:flex;gap:5px;align-items:center;padding:10px 14px;">
      <span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0s infinite"></span>
      <span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0.2s infinite"></span>
      <span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0.4s infinite"></span>
    </div>
  `;
  thread.appendChild(wrapper);
  thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

/* ── PANEL TABS ────────────────────────────────────────────── */
function initAssistantToggle() {
  const toggle    = document.getElementById("assistant-toggle");
  const sidePanel = document.querySelector(".side-panel");
  toggle.addEventListener("click", () => {
    sidePanel.classList.toggle("side-panel-open");
  });
}

function initSidePanelTabs() {
  const tabs           = document.querySelectorAll(".side-panel-tabs .tab");
  const assistantPanel = document.getElementById("assistant-panel");
  const insightsPanel  = document.getElementById("insights-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("tab-active"));
      tab.classList.add("tab-active");
      if (tab.getAttribute("data-panel") === "assistant") {
        assistantPanel.classList.remove("side-panel-body-hidden");
        insightsPanel.classList.add("side-panel-body-hidden");
      } else {
        assistantPanel.classList.add("side-panel-body-hidden");
        insightsPanel.classList.remove("side-panel-body-hidden");
      }
    });
  });
}

/* ── INSIGHTS ──────────────────────────────────────────────── */
function applyInsights(summary, suggestions) {
  const summaryEl = document.getElementById("insights-summary");
  const listEl    = document.getElementById("insights-list");

  if (summaryEl) {
    summaryEl.textContent = summary || "Refinement complete.";
    summaryEl.style.animation = "none";
    requestAnimationFrame(() => { summaryEl.style.animation = "chatIn 0.3s ease both"; });
  }

  if (listEl) {
    listEl.innerHTML = "";
    (suggestions || []).forEach((s, i) => {
      const li = document.createElement("li");
      li.textContent = s;
      li.style.animationDelay = `${i * 0.06}s`;
      listEl.appendChild(li);
    });
  }

  // Auto-switch to insights tab
  const tabs = document.querySelectorAll(".side-panel-tabs .tab");
  tabs.forEach((t) => t.classList.remove("tab-active"));
  const insightTab = document.querySelector(".side-panel-tabs .tab[data-panel='insights']");
  if (insightTab) insightTab.classList.add("tab-active");

  const assistantPanel = document.getElementById("assistant-panel");
  const insightsPanel  = document.getElementById("insights-panel");
  if (assistantPanel) assistantPanel.classList.add("side-panel-body-hidden");
  if (insightsPanel)  insightsPanel.classList.remove("side-panel-body-hidden");
}

/* ── REFINE BUTTON ─────────────────────────────────────────── */
function initRefineButton() {
  const button     = document.getElementById("btn-refine");
  const goalSelect = document.getElementById("goal-select");

  button.addEventListener("click", async () => {
    const code = editor.getValue().trim();
    if (!code) {
      appendChatBubble("system", "Add some code in the editor before refining.");
      return;
    }

    setStatus("Refining with Groq…", true);
    button.classList.add("loading");
    button.disabled = true;

    try {
      const res = await fetch(`${API_BASE}/api/refine`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language: currentLanguage,
          goal:     goalSelect.value,
        }),
      });
      if (!res.ok) throw new Error("Refine failed");

      const data = await res.json();

      // Animate editor value replacement
      const refined = data.refined_code || code;
      editor.setValue(refined);
      updateMetrics();
      applyInsights(data.summary, data.suggestions);
      setStatus("Refinement complete ✓", false);

      // Brief flash on status bar
      setTimeout(() => setStatus("Idle"), 3000);

    } catch (err) {
      console.error(err);
      setStatus("Error during refinement");
      appendChatBubble(
        "system",
        "Refinement failed. Make sure the backend is running and GROQ_API_KEY is configured."
      );
    } finally {
      button.classList.remove("loading");
      button.disabled = false;
    }
  });
}

/* ── CHAT FORM ─────────────────────────────────────────────── */
function initChatForm() {
  const form  = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");

  // Cmd/Ctrl+Enter to send
  input.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    appendChatBubble("user", question);
    appendTypingIndicator();
    setStatus("Thinking…", true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code_context: editor.getValue(),
          language:     currentLanguage,
          messages:     [{ role: "user", content: question }],
        }),
      });
      if (!res.ok) throw new Error("Chat failed");
      const data = await res.json();
      removeTypingIndicator();
      appendChatBubble("system", data.reply);
      setStatus("Idle");

    } catch (err) {
      console.error(err);
      removeTypingIndicator();
      appendChatBubble("system", "Chat failed. Ensure the backend is running and Groq is reachable.");
      setStatus("Error while answering");
    }
  });
}

/* ── FORMAT BUTTON ─────────────────────────────────────────── */
function initFormatButton() {
  const button = document.getElementById("btn-format");
  button.addEventListener("click", () => {
    const code = editor.getValue();
    const formatted = code
      .split("\n")
      .map((line) => line.replace(/\s+$/g, ""))
      .join("\n");
    editor.setValue(formatted);
    updateMetrics();
    setStatus("Formatted ✓");
    setTimeout(() => setStatus("Idle"), 1500);
  });
}

/* ── DIFF BUTTON ───────────────────────────────────────────── */
function initDiffButton() {
  const button = document.getElementById("btn-diff");
  button.addEventListener("click", () => {
    appendChatBubble(
      "system",
      "A visual diff viewer will open here. For now, compare original and refined code using the Insights panel after running a refinement."
    );
    // Switch to assistant panel so user sees the message
    const tabs = document.querySelectorAll(".side-panel-tabs .tab");
    tabs.forEach((t) => t.classList.remove("tab-active"));
    const assistantTab = document.querySelector(".side-panel-tabs .tab[data-panel='assistant']");
    if (assistantTab) assistantTab.classList.add("tab-active");
    document.getElementById("assistant-panel").classList.remove("side-panel-body-hidden");
    document.getElementById("insights-panel").classList.add("side-panel-body-hidden");
  });
}

/* ── SAVE / LOAD ───────────────────────────────────────────── */
function initSaveLoadButtons() {
  const saveBtn = document.getElementById("btn-save");
  const loadBtn = document.getElementById("btn-load");

  saveBtn.addEventListener("click", () => {
    const payload = {
      code:     editor.getValue(),
      language: currentLanguage,
      savedAt:  new Date().toISOString(),
    };
    localStorage.setItem("coderefine:lastSnippet", JSON.stringify(payload));
    setStatus("Snippet saved ✓");
    saveBtn.style.borderColor = "var(--success)";
    saveBtn.style.color = "var(--success)";
    setTimeout(() => {
      setStatus("Idle");
      saveBtn.style.borderColor = "";
      saveBtn.style.color = "";
    }, 1500);
  });

  loadBtn.addEventListener("click", () => {
    const raw = localStorage.getItem("coderefine:lastSnippet");
    if (!raw) {
      setStatus("No saved snippet");
      return;
    }
    const payload = JSON.parse(raw);
    editor.setValue(payload.code || "");
    currentLanguage = payload.language || "python";
    document.getElementById("language-select").value = currentLanguage;
    if (window.monaco && editor) {
      monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(currentLanguage));
    }
    updateFileNameBadge();
    updateMetrics();
    setStatus("Snippet loaded ✓");
    setTimeout(() => setStatus("Idle"), 1500);
  });
}

/* ── APP START ─────────────────────────────────────────────── */
function startApp() {
  if (appStarted) return;
  appStarted = true;

  showAppShell();
  initThemeSwitcher();
  initEditor();
  initLanguageSelect();
  initAssistantToggle();
  initSidePanelTabs();
  initRefineButton();
  initChatForm();
  initFormatButton();
  initDiffButton();
  initSaveLoadButtons();
  updateFileNameBadge();
  pingBackend();

  // Re-ping every 30s
  setInterval(pingBackend, 30_000);
}

/* ── BOOTSTRAP ─────────────────────────────────────────────── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    domReady = true;
    initAuth();
    if (monacoReady && authReady) startApp();
  });
} else {
  domReady = true;
  initAuth();
}

if (typeof require !== "undefined") {
  require.config({
    paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs" },
  });
  require(["vs/editor/editor.main"], () => {
    monacoReady   = true;
    window.monaco = monaco;
    if (domReady && authReady) startApp();
  });
}
