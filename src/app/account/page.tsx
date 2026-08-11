import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CircleCheck, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { ThemeLogo } from "@/components/brand-mark";
import { loadViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = {
  title: "Your account",
  robots: { index: false, follow: false },
};

type AccountPageProps = {
  searchParams: Promise<{ password?: string | string[] }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const [viewer, query] = await Promise.all([loadViewer(), searchParams]);
  if (!viewer.authenticated) redirect("/auth/sign-in?next=/account");
  const passwordUpdated = (Array.isArray(query.password) ? query.password[0] : query.password) === "updated";
  return (
    <main className="center-page">
      <section className="auth-card account-card">
        <ThemeLogo className="auth-logo" size={72} priority />
        <span className="eyebrow"><ShieldCheck size={14} /> Busted Minds Account</span>
        <h1>You’re synced.</h1>
        <p>Your threads and username follow your Busted Minds Account across apps and devices.</p>
        {passwordUpdated && (
          <div className="account-success" role="status">
            <CircleCheck aria-hidden size={19} />
            <span><strong>Password updated.</strong> You’re securely back in Busted Minds AI.</span>
          </div>
        )}
        <dl className="account-details">
          <div><dt>Username</dt><dd>{viewer.username ? `@${viewer.username}` : "Syncs at next sign-in"}</dd></div>
          <div><dt>Email</dt><dd>{viewer.email ?? "Private account"}</dd></div>
          <div><dt>Conversation limit</dt><dd>Unlimited</dd></div>
        </dl>
        <p className="account-identity-note">Your username is managed by Busted Minds Account and cannot be edited in BMAI.</p>
        <div className="auth-actions">
          <Link className="ghost-button" href="/"><ArrowLeft size={17} /> Back to chat</Link>
          <Link className="ghost-button" href="https://accounts.bustedminds.us.kg/auth?mode=forgot&source=bmai&next=%2Faccount"><KeyRound size={17} /> Reset password</Link>
          <form action="/auth/sign-out" method="post">
            <button className="danger-button" type="submit"><LogOut size={17} /> Sign out</button>
          </form>
        </div>
      </section>
    </main>
  );
}
