"use client";

import { Cloud, CloudAlert, LoaderCircle, LogIn, LogOut, Mail, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteAccount, signOut, startSync, stopSync, supabase, useSyncStatus } from "@/lib/cloud";
import { cn } from "@/lib/utils";
import { useFactoryStore } from "@/store/useFactoryStore";

const buttonClass = cn(
  "flex items-center gap-2 px-3 py-1.5 text-sm",
  "text-[var(--text-muted)] hover:text-[var(--accent-gold)]",
  "border border-[var(--border)] hover:border-[var(--accent-gold-dim)]",
  "rounded-md transition-all",
);
const optionClass =
  "w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent-gold)] hover:border-[var(--accent-gold-dim)] transition-colors";

const statusIcon = {
  off: Cloud,
  syncing: LoaderCircle,
  synced: Cloud,
  error: CloudAlert,
};
const statusText = {
  off: "Not syncing",
  syncing: "Syncing…",
  synced: "Saved to your account",
  error: "Sync failed, retrying",
};

/** Sign in with Google, GitHub or an email link; while signed in, servers and factories sync to the account. */
export function AccountMenu() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const status = useSyncStatus((s) => s.status);
  const ref = useRef<HTMLDivElement>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      setUser(session ? { id: session.user.id, email: session.user.email } : null),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  // Sync while signed in, once the local store has loaded
  useEffect(() => {
    if (!userId) return;
    const go = () => startSync(userId);
    const unsub = useFactoryStore.persist.hasHydrated() ? (go(), undefined) : useFactoryStore.persist.onFinishHydration(go);
    return () => {
      unsub?.();
      stopSync();
    };
  }, [userId]);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!supabase) return null;
  const auth = supabase.auth;
  const redirectTo = () => window.location.origin + window.location.pathname;

  const oauth = async (provider: "google" | "github") => {
    const { error } = await auth.signInWithOAuth({ provider, options: { redirectTo: redirectTo() } });
    if (error) setMessage(error.message);
  };

  const emailLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    // pkce: the link only works in this browser, which holds the code verifier
    setMessage(error ? error.message : `Check ${email} for a sign-in link. Open it in this browser.`);
  };

  const removeAccount = async () => {
    if (!window.confirm("Delete your account and all servers and factories saved in it? This can't be undone.")) return;
    const error = await deleteAccount();
    if (error) setMessage(`Couldn't delete account: ${error}`);
    else setOpen(false);
  };

  const StatusIcon = statusIcon[status];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className={buttonClass}>
        {user ? (
          <StatusIcon className={cn("w-4 h-4", status === "syncing" && "animate-spin", status === "error" && "text-[var(--error)]")} />
        ) : (
          <LogIn className="w-4 h-4" />
        )}
        <span className="hidden sm:inline max-w-40 truncate">{user ? user.email ?? "Account" : "Sign in"}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 bg-[var(--surface-elevated)] border border-[var(--border)] rounded-xl shadow-xl p-4 z-50 flex flex-col gap-3">
          {user ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-[var(--text-primary)] truncate">{user.email}</span>
                <span className="text-xs text-[var(--text-muted)]">{statusText[status]}</span>
              </div>
              <button onClick={() => signOut().then(() => setOpen(false))} className={optionClass}>
                <LogOut className="w-4 h-4" /> Sign out
              </button>
              <button onClick={removeAccount} className={cn(optionClass, "hover:text-[var(--error)] hover:border-[var(--error)]")}>
                <Trash2 className="w-4 h-4" /> Delete account
              </button>
              {message && <p className="text-xs text-[var(--error)]">{message}</p>}
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--text-muted)]">
                Sign in to keep your servers and factories in sync across devices.
              </p>
              <button onClick={() => oauth("google")} className={optionClass}>Continue with Google</button>
              <button onClick={() => oauth("github")} className={optionClass}>Continue with GitHub</button>
              <form onSubmit={emailLink} className="flex flex-col gap-2">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-label="Email"
                  className="bg-[var(--background-deep)] text-sm px-3 py-2 rounded-md border border-[var(--border)] outline-none focus:border-[var(--accent-gold)] text-[var(--text-primary)]"
                />
                <button type="submit" className={optionClass}>
                  <Mail className="w-4 h-4" /> Email me a sign-in link
                </button>
              </form>
              {message && <p className="text-xs text-[var(--text-secondary)]">{message}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
