import Link from "next/link";
import { ArrowLeft, LogOut, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { ThemeLogo } from "@/components/brand-mark";
import { loadViewer } from "@/lib/auth/viewer";

export const metadata = { title: "Your account" };

export default async function AccountPage() {
  const viewer = await loadViewer();
  if (!viewer.authenticated) redirect("/auth/sign-in?next=/account");
  return (
    <main className="center-page">
      <section className="auth-card account-card">
        <ThemeLogo className="auth-logo" size={72} priority />
        <span className="eyebrow"><ShieldCheck size={14} /> Busted Minds Account</span>
        <h1>You’re synced.</h1>
        <p>Your threads live with your Busted Minds Account and follow you across devices.</p>
        <dl className="account-details">
          <div><dt>Email</dt><dd>{viewer.email ?? "Private account"}</dd></div>
          <div><dt>Conversation limit</dt><dd>Unlimited</dd></div>
        </dl>
        <div className="auth-actions">
          <Link className="ghost-button" href="/"><ArrowLeft size={17} /> Back to chat</Link>
          <form action="/auth/sign-out" method="post">
            <button className="danger-button" type="submit"><LogOut size={17} /> Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
}
