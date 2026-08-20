import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";
import { ThemeLogo } from "@/components/brand-mark";

export const metadata: Metadata = {
  title: "Sign-in trouble",
  robots: { index: false, follow: false },
};

export default function AuthErrorPage() {
  return (
    <main className="center-page">
      <section className="auth-card">
        <ThemeLogo className="auth-logo" size={72} priority />
        <span className="eyebrow"><ShieldAlert size={14} /> Account connection</span>
        <h1>The handshake fumbled.</h1>
        <p>
          Your account is safe. The sign-in link may have expired, been cancelled, or hit a temporary configuration issue.
        </p>
        <div className="auth-actions">
          <Link className="primary-button" href="/account"><RefreshCw size={17} /> Try again</Link>
          <Link className="ghost-button" href="/"><ArrowLeft size={17} /> Back to chat</Link>
        </div>
      </section>
    </main>
  );
}
