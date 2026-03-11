/* ──────────────────────────────────────────────────────────────
   Coderefine Studio — app.js  (fully dynamic)
   ────────────────────────────────────────────────────────────── */

const FRONTEND_CONFIG   = window.CODEREFINE_CONFIG || {};
const API_BASE          = FRONTEND_CONFIG.API_BASE          || "http://localhost:8000";
const SUPABASE_URL      = FRONTEND_CONFIG.SUPABASE_URL      || "";
const SUPABASE_ANON_KEY = FRONTEND_CONFIG.SUPABASE_ANON_KEY || "";

let editor          = null;
let currentLanguage = "python";
let monacoReady     = false;
let domReady        = false;
let appStarted      = false;
let supabaseClient  = null;
let authReady       = false;
let originalCode    = "";   // Stores pre-refinement code for diff
let chatHistory     = [];   // Full conversation for multi-turn chat

/* ── LANGUAGE HELPERS ──────────────────────────────────────── */
const LANG_EXT = {
  python: "py", javascript: "js", java: "java",
  c: "c", cpp: "cpp", rust: "rs",
};
const LANG_MONACO = {
  python: "python", javascript: "javascript", java: "java",
  c: "c", cpp: "cpp", rust: "cpp",
};

function updateFileNameBadge() {
  const badge = document.getElementById("file-name-badge");
  if (badge) badge.textContent = `scratch.${LANG_EXT[currentLanguage] || currentLanguage}`;
}
function languageToMonaco(lang) { return LANG_MONACO[lang] || "plaintext"; }

/* ── METRICS ───────────────────────────────────────────────── */
function estimateComplexity(code) {
  const m = code.match(/(if|for|while|case|catch|elif|&&|\|\|)/g);
  return m ? m.length : 0;
}
function updateMetrics() {
  if (!editor) return;
  const code  = editor.getValue();
  const lines = code.split("\n").length;
  const chars = code.length;
  const cx    = estimateComplexity(code);
  animateCounter("metric-lines", lines);
  animateCounter("metric-chars", chars);
  const cxEl = document.getElementById("metric-complexity");
  if (cxEl) {
    cxEl.textContent = cx;
    cxEl.setAttribute("data-complexity",
      cx === 0 ? "" : cx < 5 ? "low" : cx < 15 ? "medium" : "high"
    );
  }
  const langEl = document.getElementById("metric-language");
  if (langEl) langEl.textContent = currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
}
let counterTimers = {};
function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent, 10) || 0;
  if (current === target) return;
  clearTimeout(counterTimers[id]);
  const step = Math.ceil(Math.abs(target - current) / 8);
  const dir  = target > current ? 1 : -1;
  let val    = current;
  function tick() {
    val = dir === 1 ? Math.min(val + step, target) : Math.max(val - step, target);
    el.textContent = val;
    if (val !== target) counterTimers[id] = setTimeout(tick, 16);
  }
  tick();
}

/* ── STATUS ────────────────────────────────────────────────── */
function setStatus(text, active) {
  if (active === undefined) active = false;
  var el = document.getElementById("status-indicator");
  if (!el) return;
  // Never display bare "Idle" text — just clear it
  el.textContent = (!text || text === "Idle") ? "" : text;
  el.setAttribute("data-active", active ? "true" : "false");
}

/* ── BACKEND PING ──────────────────────────────────────────── */
async function pingBackend() {
  const pill = document.getElementById("backend-status");
  if (!pill) return;
  try {
    const res = await fetch(API_BASE + "/health");
    if (!res.ok) throw new Error();
    pill.textContent = "Online";
    pill.className = "pill pill-success";
  } catch(e) {
    pill.textContent = "Offline";
    pill.className = "pill pill-danger";
  }
}

/* ── TOAST NOTIFICATIONS ───────────────────────────────────── */
function showToast(message, type) {
  if (!type) type = "info";
  var duration = 3000;
  var container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = "position:fixed;bottom:36px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;";
    document.body.appendChild(container);
  }
  var colors = { info: "var(--accent)", success: "var(--success)", error: "var(--danger)", warning: "var(--warning)" };
  var color = colors[type] || colors.info;
  var toast = document.createElement("div");
  toast.style.cssText = "background:var(--bg-elevated);border:1px solid " + color + ";border-left:3px solid " + color + ";color:var(--fg);padding:10px 16px;border-radius:10px;font-size:0.8rem;box-shadow:0 8px 30px rgba(0,0,0,0.5);pointer-events:all;animation:fadeUp 0.3s cubic-bezier(0.16,1,0.3,1);display:flex;align-items:center;gap:8px;max-width:280px;transition:opacity 0.3s,transform 0.3s;";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(function() { toast.remove(); }, 300);
  }, duration);
}

/* ── THEME SWITCHER ────────────────────────────────────────── */
function initThemeSwitcher() {
  var html  = document.documentElement;
  var saved = localStorage.getItem("coderefine:theme") || "dark";
  html.setAttribute("data-theme", saved);
  document.querySelectorAll(".theme-pill").forEach(function(pill) {
    var choice = pill.getAttribute("data-theme-choice");
    pill.classList.toggle("theme-pill-active", choice === saved);
    pill.addEventListener("click", function() {
      var c = pill.getAttribute("data-theme-choice");
      html.setAttribute("data-theme", c);
      localStorage.setItem("coderefine:theme", c);
      if (window.monaco) monaco.editor.setTheme(c === "light" ? "vs" : "vs-dark");
      document.querySelectorAll("[data-theme-choice]").forEach(function(p) {
        p.classList.toggle("theme-pill-active", p.getAttribute("data-theme-choice") === c);
      });
    });
  });
}

/* ── EDITOR ────────────────────────────────────────────────── */
function initEditor() {
  var container = document.getElementById("editor-container")
    || document.querySelector(".monaco-container")
    || document.querySelector(".monaco-editor-wrap");
  if (!container) return;
  var savedFontSize = parseInt(localStorage.getItem("coderefine:fontSize") || "13", 10);
  var wordWrap = localStorage.getItem("coderefine:wordWrap") !== "off" ? "on" : "off";
  var tabSize  = parseInt(localStorage.getItem("coderefine:tabSize") || "4", 10);
  editor = monaco.editor.create(container, {
    value:               "# Paste or type code here to refine it.\n\n",
    language:            languageToMonaco(currentLanguage),
    theme:               localStorage.getItem("coderefine:theme") === "light" ? "vs" : "vs-dark",
    automaticLayout:     true,
    fontSize:            savedFontSize,
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
    guides:              { bracketPairs: true },
    wordWrap:            wordWrap,
    tabSize:             tabSize,
    scrollbar: { useShadows: false, verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
  });
  editor.onDidChangeModelContent(updateMetrics);
  updateMetrics();
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
    document.getElementById("btn-save") && document.getElementById("btn-save").click();
  });
  editor.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, function() {
    document.getElementById("btn-format") && document.getElementById("btn-format").click();
  });
}

function initLanguageSelect() {
  var select = document.getElementById("language-select");
  if (!select) return;
  select.addEventListener("change", function() {
    currentLanguage = select.value;
    if (editor && window.monaco) {
      monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(currentLanguage));
    }
    updateFileNameBadge();
    var langEl = document.getElementById("metric-language");
    if (langEl) langEl.textContent = currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
  });
}

/* ── AUTH ──────────────────────────────────────────────────── */
function showAppShell() {
  var root = document.getElementById("app-root")
    || document.querySelector(".ide-root")
    || document.querySelector(".app-shell");
  if (root) root.style.display = "flex";
}

async function getAuthToken() {
  if (!supabaseClient) return null;
  var data = (await supabaseClient.auth.getSession()).data;
  return data && data.session ? data.session.access_token : null;
}

function initAuth() {
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showAppShell();
    authReady = true;
    if (monacoReady && domReady && !appStarted) startApp();
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  supabaseClient.auth.getSession().then(function(result) {
    var data = result.data;
    if (!data || !data.session) {
      window.location.href = "auth.html";
    } else {
      showAppShell();
      authReady = true;
      if (monacoReady && domReady && !appStarted) startApp();
    }
  });
  var logoutBtn = document.getElementById("btn-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async function() {
      await supabaseClient.auth.signOut();
      window.location.href = "index.html";
    });
  }
}

/* ── HISTORY ───────────────────────────────────────────────── */
var HISTORY_KEY  = "coderefine:history";
var SNIPPETS_KEY = "coderefine:snippets";
var BOOKMARKS_KEY= "coderefine:bookmarks";
var NOTIFS_KEY   = "coderefine:notifications";

function getHistory()       { try { return JSON.parse(localStorage.getItem(HISTORY_KEY)   || "[]"); } catch(e) { return []; } }
function getSnippets()      { try { return JSON.parse(localStorage.getItem(SNIPPETS_KEY)  || "[]"); } catch(e) { return []; } }
function getBookmarks()     { try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]"); } catch(e) { return []; } }
function getNotifications() { try { return JSON.parse(localStorage.getItem(NOTIFS_KEY)    || "[]"); } catch(e) { return []; } }

function addToHistory(entry) {
  var history = getHistory();
  history.unshift(Object.assign({}, entry, { id: Date.now(), savedAt: new Date().toISOString() }));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 20)));
  updateHistoryBadge();
}

function updateHistoryBadge() {
  var badge = document.querySelector("#sb-history .sidebar-badge");
  if (badge) badge.textContent = getHistory().length;
}

function addNotification(message, type) {
  if (!type) type = "info";
  var notifs = getNotifications();
  notifs.unshift({ message: message, type: type, read: false, time: new Date().toISOString() });
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(notifs.slice(0, 30)));
  updateNotifBadge();
}

function updateNotifBadge() {
  var dot = document.querySelector("#sb-notifications .sidebar-badge-dot");
  var unread = getNotifications().filter(function(n) { return !n.read; }).length;
  if (dot) dot.style.display = unread > 0 ? "block" : "none";
}

/* ── ESCAPE HTML ────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── MODAL HELPERS ─────────────────────────────────────────── */
function createModal(title, bodyHTML) {
  var backdrop = document.createElement("div");
  backdrop.id = "modal-backdrop";
  backdrop.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:8000;display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn 0.15s ease;backdrop-filter:blur(4px);";
  backdrop.innerHTML = '<div style="background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:16px;box-shadow:0 40px 120px rgba(0,0,0,0.7);width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;animation:scaleIn 0.2s cubic-bezier(0.16,1,0.3,1);">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0;">'
    + '<h2 style="font-family:var(--font-display);font-size:1rem;font-weight:700;color:var(--fg);">' + escHtml(title) + '</h2>'
    + '<button onclick="window.closeModal()" style="width:28px;height:28px;border:none;background:rgba(255,255,255,0.06);border-radius:8px;color:var(--fg-muted);cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;">&#x2715;</button>'
    + '</div>'
    + '<div style="padding:20px;overflow-y:auto;flex:1;">' + bodyHTML + '</div>'
    + '</div>';
  backdrop.addEventListener("click", function(e) { if (e.target === backdrop) window.closeModal(); });
  return backdrop;
}

window.closeModal = function() {
  var el = document.getElementById("modal-backdrop");
  if (el) el.remove();
};

function closeAllModals() {
  var m = document.getElementById("modal-backdrop");   if (m) m.remove();
  var p = document.getElementById("profile-menu");     if (p) p.remove();
}

/* ── HISTORY PANEL ─────────────────────────────────────────── */
function openHistoryPanel() {
  closeAllModals();
  var history = getHistory();
  var listHTML = "";
  if (history.length === 0) {
    listHTML = '<p style="color:var(--fg-muted);font-size:0.82rem;text-align:center;padding:24px;">No refinement history yet.<br>Run a refinement to start tracking.</p>';
  } else {
    history.forEach(function(item, i) {
      listHTML += '<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.02);margin-bottom:6px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
        + '<span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--accent);">' + escHtml(item.language || "unknown") + '</span>'
        + '<span style="font-size:0.68rem;color:var(--fg-dim);">' + new Date(item.savedAt).toLocaleString() + '</span>'
        + '</div>'
        + '<div style="font-size:0.78rem;color:var(--fg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escHtml((item.summary || item.code || "").slice(0, 80)) + '…</div>'
        + '<div style="display:flex;gap:6px;margin-top:8px;">'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;" onclick="window.restoreHistory(' + i + ');window.closeModal();">Restore</button>'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;color:var(--danger);border-color:rgba(244,63,94,0.3);" onclick="window.deleteHistory(' + i + ');">Delete</button>'
        + '</div></div>';
    });
  }
  var modal = createModal("History",
    '<div style="display:flex;flex-direction:column;gap:0;max-height:400px;overflow-y:auto;">' + listHTML + '</div>'
    + '<div style="display:flex;justify-content:flex-end;margin-top:12px;">'
    + '<button class="btn" style="color:var(--danger);border-color:rgba(244,63,94,0.3);font-size:0.78rem;" onclick="window.clearHistory();">Clear All</button>'
    + '</div>'
  );
  document.body.appendChild(modal);
}

window.restoreHistory = function(index) {
  var item = getHistory()[index];
  if (!item) return;
  editor.setValue(item.code || "");
  if (item.language) {
    currentLanguage = item.language;
    var langSelect = document.getElementById("language-select");
    if (langSelect) langSelect.value = item.language;
    if (window.monaco) monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(item.language));
  }
  updateFileNameBadge(); updateMetrics();
  showToast("History restored", "success");
};
window.deleteHistory = function(index) {
  var history = getHistory();
  history.splice(index, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  updateHistoryBadge();
  window.closeModal(); openHistoryPanel();
};
window.clearHistory = function() {
  localStorage.removeItem(HISTORY_KEY);
  updateHistoryBadge();
  window.closeModal();
  showToast("History cleared", "info");
};

/* ── SNIPPETS PANEL ────────────────────────────────────────── */
function openSnippetsPanel() {
  closeAllModals();
  var snippets = getSnippets();
  var listHTML = "";
  if (snippets.length === 0) {
    listHTML = '<p style="color:var(--fg-muted);font-size:0.82rem;text-align:center;padding:24px;">No snippets saved yet.<br>Enter a name and hit Save Current.</p>';
  } else {
    snippets.forEach(function(s, i) {
      listHTML += '<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.02);margin-bottom:6px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
        + '<span style="font-weight:600;font-size:0.82rem;color:var(--fg);">' + escHtml(s.name) + '</span>'
        + '<span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--accent);">' + escHtml(s.language) + '</span>'
        + '</div>'
        + '<div style="font-size:0.72rem;color:var(--fg-dim);margin-bottom:8px;">' + new Date(s.savedAt).toLocaleDateString() + '</div>'
        + '<div style="display:flex;gap:6px;">'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;" onclick="window.loadSnippet(' + i + ');window.closeModal();">Load</button>'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;color:var(--danger);border-color:rgba(244,63,94,0.3);" onclick="window.deleteSnippet(' + i + ');">Delete</button>'
        + '</div></div>';
    });
  }
  var modal = createModal("Snippets",
    '<div style="display:flex;flex-direction:column;gap:12px;">'
    + '<div style="display:flex;gap:8px;align-items:center;">'
    + '<input id="snippet-name-input" placeholder="Snippet name…" style="flex:1;background:rgba(255,255,255,0.04);border:1px solid var(--border-bright);border-radius:8px;padding:7px 12px;color:var(--fg);font-family:var(--font-body);font-size:0.82rem;outline:none;" />'
    + '<button class="btn btn-primary" style="font-size:0.78rem;padding:7px 14px;" onclick="window.saveCurrentSnippet()">Save Current</button>'
    + '</div>'
    + '<div style="max-height:360px;overflow-y:auto;">' + listHTML + '</div>'
    + '</div>'
  );
  document.body.appendChild(modal);
}

window.saveCurrentSnippet = function() {
  var nameInput = document.getElementById("snippet-name-input");
  var name = nameInput ? nameInput.value.trim() : "";
  if (!name) { showToast("Enter a snippet name", "warning"); return; }
  var snippets = getSnippets();
  snippets.unshift({ name: name, code: editor.getValue(), language: currentLanguage, savedAt: new Date().toISOString() });
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets.slice(0, 50)));
  window.closeModal();
  showToast('Snippet "' + name + '" saved', "success");
};
window.loadSnippet = function(index) {
  var s = getSnippets()[index];
  if (!s) return;
  editor.setValue(s.code);
  currentLanguage = s.language;
  var langSelect = document.getElementById("language-select");
  if (langSelect) langSelect.value = s.language;
  if (window.monaco) monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(s.language));
  updateFileNameBadge(); updateMetrics();
  showToast('Loaded "' + s.name + '"', "success");
};
window.deleteSnippet = function(index) {
  var snippets = getSnippets();
  snippets.splice(index, 1);
  localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
  window.closeModal(); openSnippetsPanel();
};

/* ── BOOKMARKS PANEL ───────────────────────────────────────── */
function openBookmarksPanel() {
  closeAllModals();
  var bookmarks = getBookmarks();
  var listHTML = "";
  if (bookmarks.length === 0) {
    listHTML = '<p style="color:var(--fg-muted);font-size:0.82rem;text-align:center;padding:24px;">No bookmarks yet.<br>Use Ctrl+D or the profile menu to bookmark code.</p>';
  } else {
    bookmarks.forEach(function(b, i) {
      listHTML += '<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(255,255,255,0.02);margin-bottom:6px;">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">'
        + '<span style="font-weight:600;font-size:0.82rem;color:var(--fg);">' + escHtml(b.label) + '</span>'
        + '<span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--accent);">' + escHtml(b.language) + '</span>'
        + '</div>'
        + '<pre style="font-family:var(--font-mono);font-size:0.72rem;color:var(--fg-muted);white-space:pre-wrap;max-height:60px;overflow:hidden;margin:4px 0 8px;">' + escHtml((b.code || "").slice(0, 120)) + '…</pre>'
        + '<div style="display:flex;gap:6px;">'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;" onclick="window.loadBookmark(' + i + ');window.closeModal();">Load</button>'
        + '<button class="btn" style="font-size:0.7rem;padding:3px 8px;color:var(--danger);border-color:rgba(244,63,94,0.3);" onclick="window.deleteBookmark(' + i + ');">Remove</button>'
        + '</div></div>';
    });
  }
  var modal = createModal("Saved", '<div style="max-height:420px;overflow-y:auto;">' + listHTML + '</div>');
  document.body.appendChild(modal);
}

window.loadBookmark = function(index) {
  var b = getBookmarks()[index];
  if (!b) return;
  editor.setValue(b.code);
  currentLanguage = b.language;
  var langSelect = document.getElementById("language-select");
  if (langSelect) langSelect.value = b.language;
  if (window.monaco) monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(b.language));
  updateFileNameBadge(); updateMetrics();
  showToast('Loaded "' + b.label + '"', "success");
};
window.deleteBookmark = function(index) {
  var bookmarks = getBookmarks();
  bookmarks.splice(index, 1);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  window.closeModal(); openBookmarksPanel();
};

function bookmarkCurrentCode() {
  var code = editor && editor.getValue().trim();
  if (!code) { showToast("Nothing to bookmark", "warning"); return; }
  var label = prompt("Bookmark label:", currentLanguage + " — " + new Date().toLocaleDateString());
  if (!label) return;
  var bookmarks = getBookmarks();
  bookmarks.unshift({ label: label, code: code, language: currentLanguage, savedAt: new Date().toISOString() });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks.slice(0, 50)));
  showToast('Bookmarked "' + label + '"', "success");
}

/* ── NOTIFICATIONS PANEL ───────────────────────────────────── */
function openNotificationsPanel() {
  closeAllModals();
  var notifs = getNotifications();
  var marked = notifs.map(function(n) { return Object.assign({}, n, { read: true }); });
  localStorage.setItem(NOTIFS_KEY, JSON.stringify(marked));
  updateNotifBadge();
  var listHTML = "";
  if (notifs.length === 0) {
    listHTML = '<p style="color:var(--fg-muted);font-size:0.82rem;text-align:center;padding:24px;">No notifications yet.</p>';
  } else {
    var colorMap = { info: "var(--accent)", success: "var(--success)", error: "var(--danger)", warning: "var(--warning)" };
    notifs.forEach(function(n) {
      var c = colorMap[n.type] || colorMap.info;
      listHTML += '<div style="padding:10px 12px;border-radius:8px;border:1px solid var(--border);border-left:3px solid ' + c + ';background:rgba(255,255,255,0.02);margin-bottom:6px;">'
        + '<div style="font-size:0.8rem;color:var(--fg);margin-bottom:4px;">' + escHtml(n.message) + '</div>'
        + '<div style="font-size:0.68rem;color:var(--fg-dim);">' + new Date(n.time).toLocaleString() + '</div>'
        + '</div>';
    });
  }
  var modal = createModal("Notifications",
    '<div style="max-height:400px;overflow-y:auto;">' + listHTML + '</div>'
    + '<div style="display:flex;justify-content:flex-end;margin-top:12px;">'
    + '<button class="btn" style="font-size:0.78rem;color:var(--danger);border-color:rgba(244,63,94,0.3);" onclick="window.clearNotifications();">Clear All</button>'
    + '</div>'
  );
  document.body.appendChild(modal);
}
window.clearNotifications = function() {
  localStorage.removeItem(NOTIFS_KEY);
  updateNotifBadge();
  window.closeModal();
  showToast("Notifications cleared", "info");
};

/* ── HELP PANEL ────────────────────────────────────────────── */
function openHelpPanel() {
  closeAllModals();
  var shortcuts = [
    ["Ctrl/Cmd + S", "Save snippet"],
    ["Ctrl/Cmd + B", "Toggle sidebar"],
    ["Alt + Shift + F", "Format code"],
    ["Ctrl/Cmd + Enter", "Send chat message"],
    ["Ctrl/Cmd + D", "Bookmark current code"],
    ["Escape", "Close modal"],
  ];
  var shortcutsHTML = shortcuts.map(function(pair) {
    return '<div style="display:flex;justify-content:space-between;padding:6px 10px;background:rgba(255,255,255,0.02);border-radius:6px;border:1px solid var(--border);margin-bottom:4px;">'
      + '<span style="font-family:var(--font-mono);color:var(--accent);font-size:0.75rem;">' + escHtml(pair[0]) + '</span>'
      + '<span style="color:var(--fg-muted);font-size:0.75rem;">' + escHtml(pair[1]) + '</span>'
      + '</div>';
  }).join("");
  var langs = ["Python","JavaScript","Java","C","C++","Rust"].map(function(l) {
    return '<span style="font-family:var(--font-mono);font-size:0.72rem;padding:2px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);border:1px solid rgba(59,130,246,0.3);margin:2px;">' + l + '</span>';
  }).join("");
  var modal = createModal("Help & Documentation",
    '<div style="display:flex;flex-direction:column;gap:16px;font-size:0.82rem;color:var(--fg-muted);">'
    + '<div><h3 style="color:var(--fg);font-size:0.9rem;margin-bottom:8px;font-family:var(--font-display);">⌨️ Keyboard Shortcuts</h3>' + shortcutsHTML + '</div>'
    + '<div><h3 style="color:var(--fg);font-size:0.9rem;margin-bottom:8px;font-family:var(--font-display);">🚀 Getting Started</h3>'
    + '<ol style="padding-left:18px;display:flex;flex-direction:column;gap:6px;line-height:1.6;">'
    + '<li>Paste or type code in the <strong style="color:var(--fg);">editor</strong>.</li>'
    + '<li>Choose your <strong style="color:var(--fg);">Language</strong> and <strong style="color:var(--fg);">Objective</strong> from the top bar.</li>'
    + '<li>Hit <strong style="color:var(--accent);">Refine with AI</strong> to get an improved version.</li>'
    + '<li>Check the <strong style="color:var(--fg);">Insights</strong> tab for detailed suggestions.</li>'
    + '<li>Use the <strong style="color:var(--fg);">Diff</strong> tab to compare before and after.</li>'
    + '<li>Chat with the AI assistant for deeper help.</li>'
    + '</ol></div>'
    + '<div><h3 style="color:var(--fg);font-size:0.9rem;margin-bottom:8px;font-family:var(--font-display);">🔧 Supported Languages</h3>'
    + '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + langs + '</div></div>'
    + '<div style="padding:10px 14px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:8px;">'
    + '<strong style="color:var(--accent);">Backend Required:</strong> AI features need the FastAPI backend running with a valid <code style="font-family:var(--font-mono);">GROQ_API_KEY</code>. See <code style="font-family:var(--font-mono);">main.py</code>.</div>'
    + '</div>'
  );
  document.body.appendChild(modal);
}

/* ── SETTINGS PANEL ────────────────────────────────────────── */
function openSettingsPanel() {
  closeAllModals();
  var savedFontSize = parseInt(localStorage.getItem("coderefine:fontSize") || "13", 10);
  var currentTheme  = localStorage.getItem("coderefine:theme") || "dark";
  var tabSize       = parseInt(localStorage.getItem("coderefine:tabSize") || "4", 10);
  var wordWrap      = localStorage.getItem("coderefine:wordWrap") !== "off";
  var themePills = ["dark","light","nebula"].map(function(t) {
    return '<button class="theme-pill ' + (t === currentTheme ? "theme-pill-active" : "") + '" data-theme-choice="' + t + '" style="flex:1;">'
      + t.charAt(0).toUpperCase() + t.slice(1) + '</button>';
  }).join("");
  var tabBtns = [2,4,8].map(function(s) {
    return '<button class="btn ' + (s === tabSize ? "btn-primary" : "") + '" data-tab-size="' + s + '" onclick="window.applyTabSize(' + s + ')" style="flex:1;font-size:0.78rem;">' + s + ' spaces</button>';
  }).join("");
  var wrapBg  = wordWrap ? "var(--accent)" : "var(--border)";
  var wrapLeft= wordWrap ? "19px" : "3px";
  var modal = createModal("Settings",
    '<div style="display:flex;flex-direction:column;gap:20px;font-size:0.82rem;">'
    + '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Appearance</label>'
    + '<div class="theme-toggle-buttons" style="display:flex;gap:4px;">' + themePills + '</div></div>'
    + '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Font Size: <span id="font-size-display">' + savedFontSize + 'px</span></label>'
    + '<input type="range" id="font-size-slider" min="11" max="20" value="' + savedFontSize + '" style="width:100%;accent-color:var(--accent);"></div>'
    + '<div><label style="display:block;font-size:0.72rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Tab Size</label>'
    + '<div style="display:flex;gap:6px;">' + tabBtns + '</div></div>'
    + '<div><label style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;">'
    + '<span style="font-size:0.72rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.06em;">Word Wrap</span>'
    + '<div id="word-wrap-toggle" onclick="window.toggleWordWrap()" style="width:36px;height:20px;border-radius:999px;background:' + wrapBg + ';position:relative;cursor:pointer;transition:background 0.2s;flex-shrink:0;">'
    + '<div id="word-wrap-knob" style="position:absolute;top:3px;left:' + wrapLeft + ';width:14px;height:14px;border-radius:50%;background:#fff;transition:left 0.2s;"></div>'
    + '</div></label></div>'
    + '<div style="padding:10px 12px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--border);">'
    + '<div style="font-size:0.72rem;font-weight:600;color:var(--fg-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">Data Management</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button class="btn" style="font-size:0.75rem;color:var(--danger);border-color:rgba(244,63,94,0.3);" onclick="window.clearAllData()">Clear All Local Data</button>'
    + '<button class="btn" style="font-size:0.75rem;" onclick="window.exportData()">Export Data</button>'
    + '</div></div>'
    + '</div>'
  );
  document.body.appendChild(modal);

  var slider  = document.getElementById("font-size-slider");
  var display = document.getElementById("font-size-display");
  if (slider) {
    slider.addEventListener("input", function() {
      var size = parseInt(slider.value, 10);
      if (display) display.textContent = size + "px";
      if (editor) editor.updateOptions({ fontSize: size });
      localStorage.setItem("coderefine:fontSize", size);
    });
  }
  document.querySelectorAll("[data-theme-choice]").forEach(function(pill) {
    pill.addEventListener("click", function() {
      var c = pill.getAttribute("data-theme-choice");
      document.documentElement.setAttribute("data-theme", c);
      localStorage.setItem("coderefine:theme", c);
      if (window.monaco) monaco.editor.setTheme(c === "light" ? "vs" : "vs-dark");
      document.querySelectorAll("[data-theme-choice]").forEach(function(p) {
        p.classList.toggle("theme-pill-active", p.getAttribute("data-theme-choice") === c);
      });
    });
  });
}

window.applyTabSize = function(size) {
  localStorage.setItem("coderefine:tabSize", size);
  if (editor) editor.updateOptions({ tabSize: size, insertSpaces: true });
  document.querySelectorAll("[data-tab-size]").forEach(function(b) {
    b.classList.toggle("btn-primary", parseInt(b.getAttribute("data-tab-size"), 10) === size);
  });
};
window.toggleWordWrap = function() {
  var current = localStorage.getItem("coderefine:wordWrap") !== "off";
  var next = !current;
  localStorage.setItem("coderefine:wordWrap", next ? "on" : "off");
  if (editor) editor.updateOptions({ wordWrap: next ? "on" : "off" });
  var toggle = document.getElementById("word-wrap-toggle");
  var knob   = document.getElementById("word-wrap-knob");
  if (toggle) toggle.style.background = next ? "var(--accent)" : "var(--border)";
  if (knob)   knob.style.left         = next ? "19px" : "3px";
};
window.clearAllData = function() {
  if (!confirm("This will clear all saved snippets, history, bookmarks, and notifications. Continue?")) return;
  [HISTORY_KEY, SNIPPETS_KEY, BOOKMARKS_KEY, NOTIFS_KEY].forEach(function(k) { localStorage.removeItem(k); });
  updateHistoryBadge(); updateNotifBadge();
  window.closeModal();
  showToast("All local data cleared", "info");
};
window.exportData = function() {
  var data = {
    history: getHistory(), snippets: getSnippets(),
    bookmarks: getBookmarks(), notifications: getNotifications(),
    exportedAt: new Date().toISOString(),
  };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement("a");
  a.href = url; a.download = "coderefine-data.json"; a.click();
  URL.revokeObjectURL(url);
  showToast("Data exported", "success");
};

/* ── PROFILE MENU ──────────────────────────────────────────── */
function initProfileMenu() {
  var profileRow = document.querySelector(".sidebar-profile");
  if (!profileRow) return;
  profileRow.addEventListener("click", function(e) {
    e.stopPropagation();
    closeAllModals();
    var rect = profileRow.getBoundingClientRect();
    var menu = document.createElement("div");
    menu.id = "profile-menu";
    menu.style.cssText = "position:fixed;left:" + rect.left + "px;bottom:" + (window.innerHeight - rect.top + 6) + "px;width:200px;background:var(--bg-elevated);border:1px solid var(--border-bright);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5);z-index:9000;overflow:hidden;animation:scaleIn 0.15s ease;";
    menu.innerHTML =
      '<div style="padding:10px 12px 8px;border-bottom:1px solid var(--border);">'
      + '<div style="font-size:0.8rem;font-weight:600;color:var(--fg);" id="pm-email">—</div>'
      + '<div style="font-size:0.68rem;color:var(--fg-dim);">Free Plan</div>'
      + '</div>'
      + '<div style="padding:6px;">'
      + '<button class="sidebar-item" style="width:100%;font-size:0.8rem;" onclick="openSettingsPanel();document.getElementById(\'profile-menu\')&&document.getElementById(\'profile-menu\').remove();">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15H4a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V4a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H20a2 2 0 0 1 0 4h-.09z"/></svg>'
      + 'Settings</button>'
      + '<button class="sidebar-item" style="width:100%;font-size:0.8rem;" onclick="bookmarkCurrentCode();document.getElementById(\'profile-menu\')&&document.getElementById(\'profile-menu\').remove();">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>'
      + 'Bookmark Code</button>'
      + '<div style="height:1px;background:var(--border);margin:4px 0;"></div>'
      + '<button class="sidebar-item" style="width:100%;font-size:0.8rem;color:var(--danger);" onclick="document.getElementById(\'btn-logout\')&&document.getElementById(\'btn-logout\').click();">'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'
      + 'Sign Out</button>'
      + '</div>';
    document.body.appendChild(menu);
    if (supabaseClient) {
      supabaseClient.auth.getSession().then(function(result) {
        var emailEl = document.getElementById("pm-email");
        if (emailEl && result.data && result.data.session) emailEl.textContent = result.data.session.user.email;
      });
    }
    function dismiss(e) {
      if (!menu.contains(e.target) && e.target !== profileRow) {
        menu.remove(); document.removeEventListener("click", dismiss);
      }
    }
    setTimeout(function() { document.addEventListener("click", dismiss); }, 0);
  });
}

/* ── DIFF VIEWER ───────────────────────────────────────────── */
var diffEditor = null;

function openDiffViewer() {
  closeAllModals();
  if (!originalCode) {
    showToast("Run a refinement first to compare before/after", "warning");
    return;
  }
  var modal = createModal("Diff Viewer — Before vs After",
    '<div style="display:flex;flex-direction:column;gap:8px;">'
    + '<div style="display:flex;gap:12px;font-size:0.72rem;color:var(--fg-muted);">'
    + '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(244,63,94,0.4);margin-right:4px;"></span>Before (original)</span>'
    + '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgba(16,185,129,0.4);margin-right:4px;"></span>After (refined)</span>'
    + '</div>'
    + '<div id="diff-editor-container" style="height:380px;border:1px solid var(--border);border-radius:8px;overflow:hidden;"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button class="btn" onclick="window.copyDiffAfter()" style="font-size:0.78rem;">Copy Refined</button>'
    + '<button class="btn btn-primary" onclick="window.closeModal()" style="font-size:0.78rem;">Close</button>'
    + '</div></div>'
  );
  document.body.appendChild(modal);
  requestAnimationFrame(function() {
    var container = document.getElementById("diff-editor-container");
    if (!container || !window.monaco) return;
    if (diffEditor) { diffEditor.dispose(); diffEditor = null; }
    diffEditor = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      theme:           localStorage.getItem("coderefine:theme") === "light" ? "vs" : "vs-dark",
      readOnly:        true,
      minimap:         { enabled: false },
      fontFamily:      "'Geist Mono', monospace",
      fontSize:        12,
      lineHeight:      20,
      renderSideBySide: true,
    });
    diffEditor.setModel({
      original: monaco.editor.createModel(originalCode,       languageToMonaco(currentLanguage)),
      modified: monaco.editor.createModel(editor.getValue(),  languageToMonaco(currentLanguage)),
    });
  });
}
window.copyDiffAfter = function() {
  var code = editor ? editor.getValue() : "";
  navigator.clipboard.writeText(code).then(function() { showToast("Refined code copied", "success"); });
};

/* ── CHAT ──────────────────────────────────────────────────── */
function appendChatBubble(role, content) {
  var thread = document.getElementById("chat-thread");
  if (!thread) return;
  var wrapper = document.createElement("div");
  wrapper.className = "chat-message " + (role === "user" ? "chat-message-user" : "chat-message-system");
  var avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.textContent = role === "user" ? "You" : "CR";
  var bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.innerHTML = escHtml(content)
    .replace(/`([^`]+)`/g, '<code style="font-family:var(--font-mono);background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  thread.appendChild(wrapper);
  requestAnimationFrame(function() { thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" }); });
}

function appendTypingIndicator() {
  var thread = document.getElementById("chat-thread");
  if (!thread) return;
  var wrapper = document.createElement("div");
  wrapper.id = "typing-indicator";
  wrapper.className = "chat-message chat-message-system";
  wrapper.innerHTML = '<div class="chat-avatar">CR</div><div class="chat-bubble" style="display:flex;gap:5px;align-items:center;padding:10px 14px;">'
    + '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0s infinite;display:inline-block;"></span>'
    + '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0.2s infinite;display:inline-block;"></span>'
    + '<span style="width:6px;height:6px;border-radius:50%;background:var(--accent);animation:statusPulse 1s ease-in-out 0.4s infinite;display:inline-block;"></span>'
    + '</div>';
  thread.appendChild(wrapper);
  thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
}
function removeTypingIndicator() {
  var el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

/* ── PANEL TABS ────────────────────────────────────────────── */
function initAssistantToggle() {
  var toggle    = document.getElementById("assistant-toggle");
  var sidePanel = document.querySelector(".side-panel") || document.querySelector(".ai-panel");
  if (toggle && sidePanel) {
    toggle.addEventListener("click", function() { sidePanel.classList.toggle("side-panel-open"); });
  }
}

function switchAIPanel(panelName) {
  var assistantPanel = document.getElementById("assistant-panel");
  var insightsPanel  = document.getElementById("insights-panel");
  if (!assistantPanel || !insightsPanel) return;
  var isAssistant = panelName === "assistant";
  assistantPanel.classList.toggle("ai-body-hidden", !isAssistant);
  insightsPanel.classList.toggle("ai-body-hidden",   isAssistant);
  document.querySelectorAll(".ai-tabs .ai-tab, .side-panel-tabs .tab").forEach(function(t) {
    var tp = t.getAttribute("data-panel");
    t.classList.toggle("active",     tp === panelName);
    t.classList.toggle("tab-active", tp === panelName);
  });
}

function initSidePanelTabs() {
  document.querySelectorAll(".side-panel-tabs .tab, .ai-tabs .ai-tab").forEach(function(tab) {
    tab.addEventListener("click", function() {
      var panel = tab.getAttribute("data-panel");
      if (panel) switchAIPanel(panel);
    });
  });
}

/* ── INSIGHTS ──────────────────────────────────────────────── */
function applyInsights(summary, suggestions) {
  var summaryEl = document.getElementById("insights-summary");
  var listEl    = document.getElementById("insights-list");
  var emptyEl   = document.querySelector(".insights-empty");
  if (emptyEl)  emptyEl.style.display = "none";
  if (summaryEl) {
    summaryEl.style.display = "block";
    summaryEl.textContent = summary || "Refinement complete.";
    summaryEl.style.animation = "none";
    requestAnimationFrame(function() { summaryEl.style.animation = "chatIn 0.3s ease both"; });
  }
  if (listEl) {
    listEl.innerHTML = "";
    (suggestions || []).forEach(function(s, i) {
      var li = document.createElement("li");
      li.textContent = s;
      li.style.animationDelay = (i * 0.06) + "s";
      listEl.appendChild(li);
    });
  }
  switchAIPanel("insights");
}

/* ── REFINE BUTTON ─────────────────────────────────────────── */
function initRefineButton() {
  var button     = document.getElementById("btn-refine");
  var goalSelect = document.getElementById("goal-select");
  if (!button) return;
  button.addEventListener("click", async function() {
    var code = editor.getValue().trim();
    if (!code || code === "# Paste or type code here to refine it.") {
      appendChatBubble("system", "Add some code in the editor before refining.");
      switchAIPanel("assistant");
      return;
    }
    originalCode = editor.getValue();
    setStatus("Refining with Groq…", true);
    button.classList.add("loading");
    button.disabled = true;
    try {
      var token   = await getAuthToken();
      var headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = "Bearer " + token;
      
      // Fetch refinement
      var res = await fetch(API_BASE + "/api/refine", {
        method: "POST", headers: headers,
        body: JSON.stringify({
          code: code, language: currentLanguage,
          goal: goalSelect ? goalSelect.value : "Improve readability, performance, and structure",
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data    = await res.json();
      var refined = data.refined_code || code;
      editor.setValue(refined);
      updateMetrics();
      applyInsights(data.summary, data.suggestions);
      setStatus("Refinement complete ✓", false);
      setTimeout(function() { setStatus("Idle"); }, 3000);
      addToHistory({ code: originalCode, language: currentLanguage, summary: data.summary });
      addNotification("Refinement complete (" + currentLanguage + ")", "success");
      showToast("Code refined successfully!", "success");
      appendChatBubble("system", "✨ Refinement complete! " + (data.summary || "") + " Check the Insights tab for detailed suggestions.");
      chatHistory.push({ role: "assistant", content: "Refinement complete! " + (data.summary || "") });
      
      // Fetch complexity analysis for the refined code
      fetchAndDisplayComplexity(refined, headers);
    } catch(err) {
      console.error(err);
      setStatus("Error during refinement");
      var msg = String(err.message).indexOf("401") >= 0
        ? "Authentication error. Please sign in again."
        : "Refinement failed. Make sure the backend is running and GROQ_API_KEY is configured.";
      appendChatBubble("system", msg);
      addNotification("Refinement failed", "error");
      showToast("Refinement failed", "error");
      switchAIPanel("assistant");
    } finally {
      button.classList.remove("loading");
      button.disabled = false;
    }
  });
}

function fetchAndDisplayComplexity(code, headers) {
  var goalSelect = document.getElementById("goal-select");
  fetch(API_BASE + "/api/complexity", {
    method: "POST", headers: headers,
    body: JSON.stringify({
      code: code, language: currentLanguage,
      goal: goalSelect ? goalSelect.value : "Improve readability, performance, and structure",
    }),
  })
  .then(function(res) { return res.json(); })
  .then(function(data) {
    displayComplexityAnalysis(data);
  })
  .catch(function(err) {
    console.warn("Complexity analysis failed:", err);
    // Don't break the flow if complexity fails
  });
}

function displayComplexityAnalysis(complexityData) {
  var listEl = document.getElementById("insights-list");
  if (!listEl) return;
  
  // Add complexity info as list items at the top
  var complexityHtml = 
    '<li style="font-weight: 600; color: var(--accent); margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border);">⏱ Time Complexity: ' + 
    complexityData.time_complexity + '</li>' +
    '<li style="font-weight: 600; color: var(--accent);">💾 Space Complexity: ' + 
    complexityData.space_complexity + '</li>';
  
  if (complexityData.explanation) {
    complexityHtml += '<li style="font-style: italic; color: var(--fg-dim); margin-top: 8px; font-size: 0.9em;">' + 
      complexityData.explanation + '</li>';
  }
  
  listEl.insertAdjacentHTML("beforeend", complexityHtml);
}

/* ── CHAT FORM ─────────────────────────────────────────────── */
function initChatForm() {
  var form  = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  if (!form || !input) return;
  input.addEventListener("keydown", function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
    requestAnimationFrame(function() {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
  });
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    var question = input.value.trim();
    if (!question) return;
    input.value = ""; input.style.height = "auto";
    switchAIPanel("assistant");
    appendChatBubble("user", question);
    appendTypingIndicator();
    setStatus("Thinking…", true);
    chatHistory.push({ role: "user", content: question });
    try {
      var token   = await getAuthToken();
      var headers = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = "Bearer " + token;
      var res = await fetch(API_BASE + "/api/chat", {
        method: "POST", headers: headers,
        body: JSON.stringify({
          code_context: editor.getValue(),
          language:     currentLanguage,
          messages:     chatHistory,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      removeTypingIndicator();
      appendChatBubble("system", data.reply);
      chatHistory.push({ role: "assistant", content: data.reply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
      setStatus("Idle");
    } catch(err) {
      console.error(err);
      removeTypingIndicator();
      var msg2 = String(err.message).indexOf("401") >= 0
        ? "Authentication error. Please sign in again."
        : "Chat failed. Ensure the backend is running and Groq is reachable.";
      appendChatBubble("system", msg2);
      setStatus("Error while answering");
    }
  });
}

/* ── FORMAT BUTTON ─────────────────────────────────────────── */
function initFormatButton() {
  var button = document.getElementById("btn-format");
  if (!button) return;
  button.addEventListener("click", function() {
    if (!editor) return;
    var code = editor.getValue();
    var formatted = code
      .split("\n")
      .map(function(line) { return line.replace(/\s+$/g, ""); })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    editor.setValue(formatted);
    updateMetrics();
    setStatus("Formatted ✓");
    showToast("Code formatted", "success");
    setTimeout(function() { setStatus("Idle"); }, 1500);
  });
}

/* ── DIFF BUTTON ───────────────────────────────────────────── */
function initDiffButton() {
  var button = document.getElementById("btn-diff");
  if (!button) return;
  button.addEventListener("click", openDiffViewer);
}

/* ── SAVE / LOAD ───────────────────────────────────────────── */
function initSaveLoadButtons() {
  var saveBtn = document.getElementById("btn-save");
  var loadBtn = document.getElementById("btn-load");

  /* ── SAVE: show export format picker ── */
  if (saveBtn) {
    saveBtn.addEventListener("click", function() {
      openSaveDialog();
    });
  }

  /* ── LOAD: file picker from desktop ── */
  if (loadBtn) {
    loadBtn.addEventListener("click", function() {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = ".py,.js,.java,.c,.cpp,.rs,.txt,.pdf,.docx";
      input.style.display = "none";
      document.body.appendChild(input);
      input.addEventListener("change", function() {
        var file = input.files && input.files[0];
        if (!file) { input.remove(); return; }
        var ext = file.name.split(".").pop().toLowerCase();
        // For text-based files: read directly
        if (["py","js","java","c","cpp","rs","txt"].includes(ext)) {
          var reader = new FileReader();
          reader.onload = function(e) {
            editor.setValue(e.target.result || "");
            // Auto-detect language from extension
            var extLangMap = { py:"python", js:"javascript", java:"java", c:"c", cpp:"cpp", rs:"rust" };
            if (extLangMap[ext]) {
              currentLanguage = extLangMap[ext];
              var sel = document.getElementById("language-select");
              if (sel) sel.value = currentLanguage;
              if (window.monaco && editor) monaco.editor.setModelLanguage(editor.getModel(), languageToMonaco(currentLanguage));
            }
            updateFileNameBadge(); updateMetrics();
            setStatus("File loaded ✓");
            showToast("Loaded: " + file.name, "success");
            setTimeout(function() { setStatus(""); }, 2000);
          };
          reader.readAsText(file);
        } else {
          showToast("Only text/code files can be loaded. PDFs and Word docs are for export only.", "warning");
        }
        input.remove();
      });
      input.click();
    });
  }
}

/* ── SAVE DIALOG ────────────────────────────────────────────── */
function openSaveDialog() {
  closeAllModals();
  var code = editor ? editor.getValue() : "";
  var lang = currentLanguage;
  var ext  = LANG_EXT[lang] || "txt";
  var filename = "coderefine-" + lang + "-" + Date.now();

  var body =
    '<div style="display:flex;flex-direction:column;gap:12px;">'
    + '<p style="color:var(--fg-muted);font-size:0.82rem;margin:0;">Choose the format to save your code to your desktop:</p>'

    /* Plain code file */
    + '<button class="btn" onclick="window.saveAsCode()" style="display:flex;align-items:center;gap:12px;padding:12px 16px;text-align:left;border-color:var(--border-bright);">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
    + '<div><div style="font-weight:600;color:var(--fg);font-size:0.85rem;">Code File (.' + ext + ')</div>'
    + '<div style="font-size:0.74rem;color:var(--fg-muted);">Raw source code, preserves syntax</div></div></button>'

    /* PDF */
    + '<button class="btn" onclick="window.saveAsPDF()" style="display:flex;align-items:center;gap:12px;padding:12px 16px;text-align:left;border-color:var(--border-bright);">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>'
    + '<div><div style="font-weight:600;color:var(--fg);font-size:0.85rem;">PDF Document (.pdf)</div>'
    + '<div style="font-size:0.74rem;color:var(--fg-muted);">Formatted, printable, shareable</div></div></button>'

    /* Word */
    + '<button class="btn" onclick="window.saveAsWord()" style="display:flex;align-items:center;gap:12px;padding:12px 16px;text-align:left;border-color:var(--border-bright);">'
    + '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
    + '<div><div style="font-weight:600;color:var(--fg);font-size:0.85rem;">Word Document (.docx)</div>'
    + '<div style="font-size:0.74rem;color:var(--fg-muted);">Editable in Microsoft Word / Google Docs</div></div></button>'

    + '</div>';

  var modal = createModal("Save File", body);
  document.body.appendChild(modal);

  /* Expose helpers on window so inline onclick can reach them */
  window._saveCode = code;
  window._saveLang = lang;
  window._saveExt  = ext;
  window._saveFilename = filename;
}

/* save as raw code file */
window.saveAsCode = function() {
  var blob = new Blob([window._saveCode || ""], { type: "text/plain" });
  triggerDownload(blob, window._saveFilename + "." + window._saveExt);
  window.closeModal();
  showToast("Code file saved", "success");
};

/* save as PDF using the browser's print-to-PDF with styled HTML */
window.saveAsPDF = function() {
  window.closeModal();
  var code = window._saveCode || "";
  var lang = window._saveLang || "code";
  var filename = window._saveFilename + ".pdf";

  var printWin = window.open("", "_blank", "width=900,height=700");
  if (!printWin) { showToast("Allow pop-ups to save PDF", "warning"); return; }

  var escaped = code
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  printWin.document.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<title>' + lang + ' — Coderefine</title>'
    + '<style>'
    + 'body{margin:0;padding:32px;font-family:"Courier New",monospace;background:#0d1117;color:#c9d1d9;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    + 'h1{font-size:14px;color:#58a6ff;margin:0 0 8px;font-family:system-ui,sans-serif;}'
    + 'p{font-size:11px;color:#8b949e;margin:0 0 20px;font-family:system-ui,sans-serif;}'
    + 'pre{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;margin:0;}'
    + '@media print{body{background:#0d1117 !important;}}'
    + '</style>'
    + '</head><body>'
    + '<h1>Coderefine Studio — ' + lang.charAt(0).toUpperCase()+lang.slice(1) + ' Code</h1>'
    + '<p>Exported ' + new Date().toLocaleString() + '</p>'
    + '<pre>' + escaped + '</pre>'
    + '<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};}<\/script>'
    + '</body></html>'
  );
  printWin.document.close();
  showToast("PDF export opened — use browser Print → Save as PDF", "info");
};

/* save as .docx using a minimal WordprocessingML XML blob */
window.saveAsWord = function() {
  window.closeModal();
  var code = window._saveCode || "";
  var lang = window._saveLang || "code";

  // Build a minimal .docx XML structure (WordprocessingML)
  var escaped = code
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

  // Split into lines and build <w:p> paragraphs
  var lines = escaped.split("\n");
  var paras = lines.map(function(line) {
    return '<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/></w:pPr>'
      + '<w:r><w:rPr>'
      + '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'
      + '<w:sz w:val="18"/><w:szCs w:val="18"/>'
      + '</w:rPr>'
      + '<w:t xml:space="preserve">' + (line || ' ') + '</w:t></w:r></w:p>';
  }).join("\n");

  var title = lang.charAt(0).toUpperCase() + lang.slice(1) + ' Code — Coderefine Studio';
  var date  = new Date().toLocaleString();

  var xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<w:body>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>' + title + '</w:t></w:r></w:p>'
    + '<w:p><w:r><w:rPr><w:color w:val="888888"/><w:sz w:val="18"/></w:rPr><w:t>Exported: ' + date + '</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t> </w:t></w:r></w:p>'
    + paras
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
    + '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    + '</w:body></w:document>';

  // Wrap in a minimal .docx zip (Office Open XML)
  // We build the zip manually as a Blob using the multi-part approach
  buildDocx(xml, lang);
};

function buildDocx(documentXml, lang) {
  // Minimal OOXML package: [Content_Types].xml + word/document.xml + _rels/.rels + word/_rels/document.xml.rels
  var contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';

  var rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

  var wordRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '</Relationships>';

  // Build zip in memory using JSZip if available, else fall back to raw XML download
  if (window.JSZip) {
    var zip = new window.JSZip();
    zip.file("[Content_Types].xml", contentTypes);
    zip.file("_rels/.rels", rels);
    zip.file("word/document.xml", documentXml);
    zip.file("word/_rels/document.xml.rels", wordRels);
    zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })
      .then(function(blob) {
        triggerDownload(blob, "coderefine-" + lang + "-" + Date.now() + ".docx");
        showToast("Word document saved", "success");
      });
  } else {
    // Load JSZip dynamically then retry
    var script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
    script.onload = function() { buildDocx(documentXml, lang); };
    script.onerror = function() {
      // Final fallback: download raw XML with .docx extension (Word can open it)
      var blob = new Blob([documentXml], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      triggerDownload(blob, "coderefine-" + lang + "-" + Date.now() + ".docx");
      showToast("Word document saved (basic format)", "success");
    };
    document.head.appendChild(script);
  }
}

function triggerDownload(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a   = document.createElement("a");
  a.href  = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* ── SIDEBAR ───────────────────────────────────────────────── */
function initSidebar() {
  var sidebar = document.getElementById("left-sidebar");
  var toggle  = document.getElementById("btn-sidebar-toggle");
  var overlay = document.getElementById("sidebar-overlay");
  if (!sidebar) return;

  function isMobile() { return window.innerWidth <= 760; }
  function openSidebar() {
    sidebar.classList.add("sidebar-open");
    sidebar.classList.remove("sidebar-collapsed");
    if (overlay && isMobile()) overlay.classList.add("active");
  }
  function closeSidebar() {
    if (isMobile()) {
      sidebar.classList.remove("sidebar-open");
      if (overlay) overlay.classList.remove("active");
    } else {
      sidebar.classList.add("sidebar-collapsed");
      if (overlay) overlay.classList.remove("active");
    }
  }
  function toggleSidebar() {
    if (isMobile()) {
      sidebar.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
    } else {
      sidebar.classList.contains("sidebar-collapsed") ? openSidebar() : closeSidebar();
    }
    // Re-layout Monaco after the full CSS transition to prevent blur artefact
    if (editor) {
      setTimeout(function() { editor.layout(); }, 50);
      setTimeout(function() { editor.layout(); }, 270);
    }
  }

  if (toggle)  toggle.addEventListener("click", toggleSidebar);
  if (overlay) overlay.addEventListener("click", closeSidebar);

  window.addEventListener("keydown", function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); toggleSidebar(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "d") { e.preventDefault(); bookmarkCurrentCode(); }
  });

  sidebar.querySelectorAll(".sidebar-item:not(.sidebar-item-primary)").forEach(function(item) {
    item.addEventListener("click", function() {
      sidebar.querySelectorAll(".sidebar-item:not(.sidebar-item-primary)").forEach(function(i) { i.classList.remove("active"); });
      item.classList.add("active");
      if (isMobile()) closeSidebar();
    });
  });

  // Wire all sidebar buttons
  var sbNew = document.getElementById("sb-new-file");
  if (sbNew) sbNew.addEventListener("click", function() {
    if (!editor) return;
    if (editor.getValue().trim() && !confirm("Discard current code and start a new file?")) return;
    editor.setValue("# New file\n\n");
    chatHistory = []; originalCode = "";
    updateMetrics();
    showToast("New file created", "info");
  });

  var sbDiff = document.getElementById("sb-diff");
  if (sbDiff) sbDiff.addEventListener("click", openDiffViewer);

  var sbFmt = document.getElementById("sb-formatter");
  if (sbFmt) sbFmt.addEventListener("click", function() {
    var btn = document.getElementById("btn-format");
    if (btn) btn.click();
  });

  var sbIns = document.getElementById("sb-insights");
  if (sbIns) sbIns.addEventListener("click", function() { switchAIPanel("insights"); });

  var sbHistory = document.getElementById("sb-history");
  if (sbHistory) sbHistory.addEventListener("click", openHistoryPanel);

  var sbSnippets = document.getElementById("sb-snippets");
  if (sbSnippets) sbSnippets.addEventListener("click", openSnippetsPanel);

  var sbBookmarks = document.getElementById("sb-bookmarks");
  if (sbBookmarks) sbBookmarks.addEventListener("click", openBookmarksPanel);

  var sbNotifs = document.getElementById("sb-notifications");
  if (sbNotifs) sbNotifs.addEventListener("click", openNotificationsPanel);

  var sbHelp = document.getElementById("sb-help");
  if (sbHelp) sbHelp.addEventListener("click", openHelpPanel);

  var sbSettings = document.getElementById("sb-settings");
  if (sbSettings) sbSettings.addEventListener("click", openSettingsPanel);

  // Populate user info from Supabase
  if (supabaseClient) {
    supabaseClient.auth.getSession().then(function(result) {
      var data = result.data;
      if (data && data.session) {
        var email = data.session.user.email || "User";
        var nameEl  = document.getElementById("sb-username");
        var avatarEl = document.querySelector(".sidebar-avatar");
        if (nameEl)   nameEl.textContent   = email.split("@")[0];
        if (avatarEl) avatarEl.textContent = email[0].toUpperCase();
      }
    });
  }
}

/* ── GLOBAL KEYBOARD SHORTCUTS ─────────────────────────────── */
function initGlobalKeyboardShortcuts() {
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeAllModals();
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
  initSidebar();
  initProfileMenu();
  initRefineButton();
  initChatForm();
  initFormatButton();
  initDiffButton();
  initSaveLoadButtons();
  initGlobalKeyboardShortcuts();
  updateFileNameBadge();
  updateHistoryBadge();
  updateNotifBadge();
  pingBackend();
  setInterval(pingBackend, 30000);

  if (getNotifications().length === 0) {
    addNotification("Welcome to Coderefine Studio! Paste code and hit Refine with AI.", "info");
  }
}

/* ── BOOTSTRAP ─────────────────────────────────────────────── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function() {
    domReady = true;
    initAuth();
    if (monacoReady && authReady) startApp();
  });
} else {
  domReady = true;
  initAuth();
}

if (typeof require !== "undefined") {
  require.config({ paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.52.0/min/vs" } });
  require(["vs/editor/editor.main"], function() {
    monacoReady   = true;
    window.monaco = monaco;
    if (domReady && authReady) startApp();
  });
}
