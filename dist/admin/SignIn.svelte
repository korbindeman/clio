<script lang="ts">
  import { tick, onMount, onDestroy } from "svelte";
  let {
    demo = false,
    destination = "/admin/",
    approved = false,
    errorMessage = "",
    welcome = "Welcome.",
  }: {
    demo?: boolean;
    destination?: string;
    approved?: boolean;
    errorMessage?: string;
    // Shown once the sign-in is approved, e.g. "Welcome, Sam."
    welcome?: string;
  } = $props();
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(welcomeTimer));
  let email = $state("");
  let code = $state("");
  let step = $state<"email" | "sent" | "welcome">(
    approved ? "welcome" : "email",
  );
  let busy = $state(false);
  let verifying = $state(false);
  let ready = $state(false);
  let error = $state(errorMessage);
  let notice = $state("");
  let resendAt = $state(0);
  let now = $state(Date.now());
  let emailInput = $state<HTMLInputElement>();
  const remaining = $derived(Math.max(0, Math.ceil((resendAt - now) / 1000)));
  const callbackURL = $derived.by(() => {
    const params = new URLSearchParams({ approved: "1" });
    if (destination) params.set("next", destination);
    return `/login/?${params}`;
  });
  // Local dev only: "admin" as the email signs straight in (routes/devLogin.ts).
  const devAdmin = (value: string) =>
    import.meta.env.DEV &&
    value === "admin" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  const localDev = $derived(ready && devAdmin("admin"));
  onMount(() => {
    ready = true;
    if (approved && !demo)
      welcomeTimer = setTimeout(
        () => window.location.assign(destination),
        2000,
      );
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  async function submit(path: string, body: object) {
    const response = await fetch(`/api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 429)
      throw new Error("Too many attempts. Wait one minute, then try again.");
    if (!response.ok) {
      if (response.status >= 500)
        throw new Error("Sign-in is unavailable. Please try again later.");
      throw new Error("The link could not be sent. Please try again.");
    }
    return response;
  }
  async function sendLink(event?: SubmitEvent) {
    event?.preventDefault();
    if (busy) return;
    busy = true;
    error = "";
    notice = "";
    try {
      email = email.trim().toLowerCase();
      if (!demo && devAdmin(email)) {
        // Local dev only: sign in as the first editor without an email.
        const response = await fetch("/api/dev-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ next: destination }),
        });
        const result = (await response
          .json()
          .catch(() => ({}))) as { url?: string; error?: string };
        if (!response.ok || !result.url)
          throw new Error(result.error || "The local sign-in failed.");
        window.location.assign(result.url);
        return;
      }
      if (!demo)
        await submit("sign-in/magic-link", {
          email,
          callbackURL,
          errorCallbackURL: "/login/",
        });
      step = "sent";
      code = "";
      now = Date.now();
      resendAt = now + 60000;
      notice = "A new sign-in email was requested.";
    } catch (e) {
      error =
        e instanceof Error ? e.message : "Check your connection and try again.";
    } finally {
      busy = false;
    }
  }
  async function approveDemo() {
    if (!demo || busy) return;
    step = "welcome";
    await tick();
    document.getElementById("welcome")?.focus();
  }
  async function submitCode(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const otp = code.replace(/\D/g, "");
    if (!demo && otp.length !== 6) {
      error = "Enter the 6-digit code from the email.";
      return;
    }
    busy = true;
    verifying = true;
    error = "";
    notice = "";
    try {
      if (!demo) {
        const response = await fetch("/api/auth/sign-in/email-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, otp }),
        });
        if (response.status === 429)
          throw new Error(
            "Too many attempts. Wait one minute, then try again.",
          );
        if (response.status === 403)
          throw new Error("Too many attempts. Request a new code.");
        if (!response.ok) {
          if (response.status >= 500)
            throw new Error("Sign-in is unavailable. Please try again later.");
          throw new Error(
            "This code is invalid or has expired. Request a new one.",
          );
        }
        window.location.assign(callbackURL);
        return;
      }
      step = "welcome";
      await tick();
      document.getElementById("welcome")?.focus();
    } catch (e) {
      error =
        e instanceof Error ? e.message : "Check your connection and try again.";
    } finally {
      verifying = false;
      busy = false;
    }
  }
  async function changeEmail() {
    step = "email";
    code = "";
    error = "";
    notice = "";
    await tick();
    emailInput?.focus();
  }
</script>

{#if demo}<p class="demo-label">Demo — no email is sent.</p>{/if}
{#if step === "welcome"}
  <h1 id="welcome" tabindex="-1">{welcome}</h1>
  {#if demo}
    <div class="actions">
      <button type="button" onclick={changeEmail}>Start again</button>
    </div>
  {/if}
{:else if step === "email"}
  <form novalidate={demo || localDev} onsubmit={sendLink} aria-busy={busy}>
    <label for="email">Email</label>
    <input
      bind:this={emailInput}
      bind:value={email}
      id="email"
      type={demo || localDev ? "text" : "email"}
      autocomplete="email"
      required={!demo}
      maxlength={demo ? undefined : 254}
      readonly={busy || !ready}
      aria-describedby={error ? "login-error" : undefined}
    />
    {#if localDev}<p class="note">Local: type admin to sign in without an email.</p>{/if}
    <button class="continue" type="submit" disabled={busy || !ready}
      >{busy ? "Sending link…" : "Continue"}<span aria-hidden="true">→</span
      ></button
    >
  </form>
{:else}
  <h1>Check your email</h1>
  <p class="note" id="link-note">
    {#if demo}
      Enter any 6-digit code, or select Approve. No email is sent in this demo.
    {:else}
      Open the message sent to {email}. Enter the 6-digit code here, or select
      Approve in the link. Both expire in 10 minutes.
    {/if}
  </p>
  <form onsubmit={submitCode} aria-busy={busy}>
    <label for="code">Code</label>
    <input
      bind:value={code}
      id="code"
      name="code"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      spellcheck="false"
      maxlength={6}
      pattern="[0-9]{6}"
      required={!demo}
      readonly={busy || !ready}
      aria-describedby={error ? "login-error" : "link-note"}
    />
    <button class="continue" type="submit" disabled={busy || !ready}
      >{verifying ? "Signing in…" : "Sign in"}<span aria-hidden="true">→</span
      ></button
    >
  </form>
  {#if demo}
    <button class="continue" type="button" onclick={approveDemo}
      >Approve<span aria-hidden="true">→</span></button
    >
  {/if}
  <div class="actions">
    {#if !demo}
      <button
        type="button"
        onclick={() => sendLink()}
        disabled={busy || remaining > 0}
        >{remaining > 0 ? `Resend in ${remaining}s` : "Send a new link"}</button
      >
    {/if}
    <button type="button" onclick={changeEmail} disabled={busy || !ready}
      >Change email</button
    >
  </div>
{/if}
{#if error}<p id="login-error" class="error" role="alert">{error}</p>{/if}
<p class="sr-only" role="status">{notice}</p>

<style>
  .demo-label {
    margin-bottom: 24px;
    font-size: 13px;
    color: #757575;
  }
  h1 {
    font-size: 32px;
    font-weight: 400;
    margin: 0 0 16px;
  }
  #welcome:focus {
    outline: none;
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
  form {
    margin-top: 0;
  }
  label {
    display: block;
    font-size: 13px;
    color: #757575;
    margin-bottom: 8px;
  }
  input {
    width: 100%;
    border: 1px solid #bdbdbd;
    background: transparent;
    border-radius: 0;
    padding: 12px 14px;
    font: inherit;
    font-size: 18px;
  }
  input:focus-visible {
    border-color: #222;
    outline: 1px solid #222;
    outline-offset: 0;
  }
  button {
    font: inherit;
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    color: #757575;
  }
  .continue {
    display: inline-flex;
    align-items: center;
    gap: 20px;
    min-height: 40px;
    margin-top: 16px;
    border: 1px solid #bdbdbd;
    border-radius: 0;
    padding: 8px 14px;
    background: transparent;
    color: #222;
  }
  .continue:hover:not(:disabled) {
    border-color: #222;
  }
  .continue:disabled {
    color: #757575;
    opacity: 0.6;
  }
  .continue:focus-visible {
    outline: 2px solid #222;
    outline-offset: 3px;
  }
  .actions button:hover:not(:disabled) {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .note {
    margin-top: 0;
    color: #757575;
    font-size: 13px;
  }
  .actions {
    display: flex;
    gap: 24px;
    justify-content: space-between;
    margin-top: 24px;
  }
  .actions button {
    background: transparent;
    border: 0;
    padding: 8px 0;
    font-size: 13px;
  }
  .error {
    margin-top: 24px;
    color: #9c3030;
    font-size: 14px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
