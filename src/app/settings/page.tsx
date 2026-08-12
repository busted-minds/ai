import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck, KeyRound, LogIn, LogOut, ShieldCheck, X } from "lucide-react";
import { AiPreferences } from "@/components/ai-preferences";
import { ThemeLogo } from "@/components/brand-mark";
import { ThemeSettings } from "@/components/theme-settings";
import { loadViewer } from "@/lib/auth/viewer";
import { normalizeCustomInstructions } from "@/lib/chat-preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account & settings",
  robots: { index: false, follow: false },
};

type SettingsPageProps = {
  searchParams: Promise<{ password?: string | string[] }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [viewer, query] = await Promise.all([loadViewer(), searchParams]);
  const passwordUpdated = (Array.isArray(query.password) ? query.password[0] : query.password) === "updated";
  let initialCustomInstructions = "";
  let customInstructionsAvailable = true;
  if (viewer.authenticated && viewer.id) {
    try {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("user_ai_preferences")
        .select("custom_instructions")
        .eq("user_id", viewer.id)
        .maybeSingle();
      if (error) throw error;
      initialCustomInstructions = normalizeCustomInstructions(data?.custom_instructions);
    } catch {
      customInstructionsAvailable = false;
    }
  }

  return (
    <main className="center-page">
      <section className="auth-card settings-card">
        <Link className="icon-button settings-close" href="/" aria-label="Close settings" title="Close settings">
          <X aria-hidden size={19} />
        </Link>
        <header className="settings-hero">
          <ThemeLogo className="auth-logo" size={72} priority />
          <h1>Account &amp; settings</h1>
          <p>Manage your Busted Minds Account details and make the AI experience yours.</p>
        </header>

        {passwordUpdated && viewer.authenticated && (
          <div className="account-success" role="status">
            <CircleCheck aria-hidden size={19} />
            <span><strong>Password updated.</strong> You’re securely back in Busted Minds AI.</span>
          </div>
        )}

        <section className="settings-section" id="account" aria-labelledby="account-heading">
          <div className="settings-section-heading">
            <div>
              <h2 id="account-heading">Account</h2>
              <p>Your identity and conversation access across Busted Minds apps.</p>
            </div>
            <span>{viewer.authenticated ? "Connected" : "Guest"}</span>
          </div>

          {viewer.authenticated ? (
            <>
              <dl className="account-details">
                <div><dt>Username</dt><dd>{viewer.username ? `@${viewer.username}` : "Syncs at next sign-in"}</dd></div>
                <div><dt>Email</dt><dd>{viewer.email ?? "Private account"}</dd></div>
                <div><dt>Conversation limit</dt><dd>Unlimited</dd></div>
              </dl>
              <p className="account-identity-note">Your username is managed by Busted Minds Account and cannot be edited in BMAI.</p>
              <div className="auth-actions settings-section-actions">
                <a className="ghost-button" href="https://accounts.bustedminds.us.kg/"><ShieldCheck size={17} /> Manage account</a>
                <a className="ghost-button" href="https://accounts.bustedminds.us.kg/auth?mode=forgot&source=bmai&next=%2Fsettings"><KeyRound size={17} /> Reset password</a>
                <form action="/auth/sign-out" method="post">
                  <button className="danger-button" type="submit"><LogOut size={17} /> Log out</button>
                </form>
              </div>
            </>
          ) : (
            <div className="settings-account-guest">
              <p>Sign in to sync your username and conversation history across devices.</p>
              <Link className="primary-button" href="/auth/sign-in?next=/settings"><LogIn size={17} /> Sign in</Link>
            </div>
          )}
        </section>

        <ThemeSettings />
        <AiPreferences
          authenticated={viewer.authenticated}
          customInstructionsAvailable={customInstructionsAvailable}
          initialCustomInstructions={initialCustomInstructions}
        />
        <div className="auth-actions">
          <Link className="ghost-button" href="/"><ArrowLeft size={17} /> Back to chat</Link>
        </div>
      </section>
    </main>
  );
}
