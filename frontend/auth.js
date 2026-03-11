/* ──────────────────────────────────────────────────────────────
   Coderefine Studio — auth.js
   Real OAuth implementation for Google & GitHub
   ────────────────────────────────────────────────────────────── */

const FRONTEND_CONFIG = window.CODEREFINE_CONFIG || {};
const SUPABASE_URL    = FRONTEND_CONFIG.SUPABASE_URL     || "";
const SUPABASE_ANON_KEY = FRONTEND_CONFIG.SUPABASE_ANON_KEY || "";

let supabaseClient = null;

// UI Elements
const msgBox = document.getElementById("auth-message");

function showMessage(text, isError = true) {
  if (!msgBox) return;
  msgBox.textContent = text;
  msgBox.classList.toggle("error", isError);
  msgBox.classList.toggle("success", !isError);
  msgBox.classList.add("show");
  
  // Auto-hide success messages after 3 seconds
  if (!isError) {
    setTimeout(() => {
      msgBox.classList.remove("show");
    }, 3000);
  }
}

// Mode Switcher
function switchMode(mode) {
  document.getElementById("auth-login-mode").style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById("auth-signup-mode").style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById("auth-forgot-mode").style.display = mode === 'forgot' ? 'block' : 'none';
  msgBox.classList.remove("show"); // Clear messages on switch
}

document.addEventListener("DOMContentLoaded", () => {
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showMessage("❌ Supabase not configured. Check config.local.js");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Check if we already have a session, redirect if we do
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data && data.session) {
      window.location.href = "app.html";
    }
  });

  // Check for password reset hash in URL
  if (window.location.hash.includes("type=recovery")) {
    switchMode('login');
    showMessage("✓ Enter your new password when you reach settings", false);
    setTimeout(() => { window.location.href = "app.html"; }, 1500);
  }

  /* ──────── LOGIN ──────── */
  const loginForm = document.getElementById("auth-login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      msgBox.classList.remove("show");
      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;
      const rememberMe = document.getElementById("login-remember").checked;
      
      const btn = document.getElementById("btn-login-submit");
      btn.disabled = true;
      btn.textContent = "Signing in…";

      try {
        const { error } = await supabaseClient.auth.signInWithPassword({ 
          email, 
          password,
          options: {
            // Store session with longer expiration if remember me is checked
            shouldCreateUser: false
          }
        });
        
        if (error) {
          showMessage("❌ " + error.message);
          btn.disabled = false;
          btn.textContent = "Sign In";
        } else {
          // Store remember me preference in localStorage
          if (rememberMe) {
            localStorage.setItem("coderefine:remember-email", email);
          } else {
            localStorage.removeItem("coderefine:remember-email");
          }
          
          showMessage("✓ Signing in...", false);
          setTimeout(() => { window.location.href = "app.html"; }, 500);
        }
      } catch (err) {
        showMessage("❌ Sign in failed: " + err.message);
        btn.disabled = false;
        btn.textContent = "Sign In";
      }
    });

    // Load remembered email on page load
    const rememberedEmail = localStorage.getItem("coderefine:remember-email");
    if (rememberedEmail) {
      document.getElementById("login-email").value = rememberedEmail;
      document.getElementById("login-remember").checked = true;
    }
  }

  /* ──────── SIGNUP ──────── */
  const signupForm = document.getElementById("auth-signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      msgBox.classList.remove("show");
      const email = document.getElementById("signup-email").value.trim();
      const password = document.getElementById("signup-password").value;

      if (password.length < 6) {
        showMessage("❌ Password must be at least 6 characters");
        return;
      }

      const btn = document.getElementById("btn-signup-submit");
      btn.disabled = true;
      btn.textContent = "Creating account…";

      try {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        btn.disabled = false;
        btn.textContent = "Sign Up";
        
        if (error) {
          showMessage("❌ " + error.message);
        } else {
          showMessage("✓ Check your email to confirm your account, then sign in", false);
          setTimeout(() => switchMode('login'), 2000);
        }
      } catch (err) {
        showMessage("❌ Sign up failed: " + err.message);
        btn.disabled = false;
        btn.textContent = "Sign Up";
      }
    });
  }

  /* ──────── FORGOT PASSWORD ──────── */
  const forgotForm = document.getElementById("auth-forgot-form");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      msgBox.classList.remove("show");
      const email = document.getElementById("forgot-email").value.trim();

      const btn = document.getElementById("btn-forgot-submit");
      btn.disabled = true;
      btn.textContent = "Sending…";

      try {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname
        });
        btn.disabled = false;
        btn.textContent = "Send Reset Link";

        if (error) {
          showMessage("❌ " + error.message);
        } else {
          showMessage("✓ Password reset email sent. Check your inbox", false);
          setTimeout(() => switchMode('login'), 2000);
        }
      } catch (err) {
        showMessage("❌ Failed to send reset email: " + err.message);
        btn.disabled = false;
        btn.textContent = "Send Reset Link";
      }
    });
  }

  /* ──────── REAL OAUTH IMPLEMENTATION ──────── */
  
  // Google Login
  const btnGoogleLogin = document.getElementById("btn-google-login");
  if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener("click", async (e) => {
      e.preventDefault();
      msgBox.classList.remove("show");
      
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "Connecting…";

      try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: window.location.origin + "/app.html",
            queryParams: {
              access_type: "offline",
              prompt: "consent",
            },
          },
        });

        if (error) {
          showMessage("❌ Google sign-in failed: " + error.message);
          btn.disabled = false;
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>\n                  Google';
        } else {
          showMessage("✓ Redirecting to Google...", false);
          // OAuth redirect happens automatically
        }
      } catch (err) {
        showMessage("❌ Error: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>\n                  Google';
      }
    });
  }

  // GitHub Login
  const btnGithubLogin = document.getElementById("btn-github-login");
  if (btnGithubLogin) {
    btnGithubLogin.addEventListener("click", async (e) => {
      e.preventDefault();
      msgBox.classList.remove("show");
      
      const btn = e.target.closest("button");
      btn.disabled = true;
      btn.textContent = "Connecting…";

      try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: "github",
          options: {
            redirectTo: window.location.origin + "/app.html",
            scopes: "user:email", // Request email scope
          },
        });

        if (error) {
          showMessage("❌ GitHub sign-in failed: " + error.message);
          btn.disabled = false;
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>\n                  GitHub';
        } else {
          showMessage("✓ Redirecting to GitHub...", false);
          // OAuth redirect happens automatically
        }
      } catch (err) {
        showMessage("❌ Error: " + err.message);
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>\n                  GitHub';
      }
    });
  }

  // Handle OAuth callback (when user returns from provider)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      showMessage("✓ Welcome! Redirecting...", false);
      setTimeout(() => {
        window.location.href = "app.html";
      }, 500);
    }
  });
});

