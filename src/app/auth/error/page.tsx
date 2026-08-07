import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";

export const metadata = { title: "Sign-in trouble" };

export default function AuthErrorPage() {
  return (
    <main className="center-page">
      <section className="auth-card">
        <Image src="/brand/bmai-logo-light.png" alt="Busted Minds AI" width={72} height={72} priority />
        <span className="eyebrow"><ShieldAlert size={14} /> Account connection</span>
        <h1>The handshake fumbled.</h1>
        <p>
          Your account is safe. The sign-in link may have expired, been cancelled, or hit a temporary configuration issue.
        </p>
        <div className="auth-actions">
          <Link className="primary-button" href="/auth/sign-in"><RefreshCw size={17} /> Try again</Link>
          <Link className="ghost-button" href="/"><ArrowLeft size={17} /> Back to chat</Link>
        </div>
      </section>
    </main>
  );
}

