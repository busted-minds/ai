import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, LockKeyhole, UserPlus, X } from "lucide-react";
import { redirect } from "next/navigation";
import accountLogo from "../../../public/brand/busted-minds.webp";
import { ThemeLogo } from "@/components/brand-mark";
import {
  accountRegistrationHref,
  accountSignInHref,
} from "@/lib/auth/account-links";
import { loadViewer } from "@/lib/auth/viewer";
import { safeNextPath } from "@/lib/security";

export const metadata: Metadata = {
  title: "Connect your Busted Minds Account",
  description: "Use one Busted Minds Account across Busted Minds AI and Busted Minds Chess.",
  robots: { index: false, follow: false },
};

type AccountPageProps = {
  searchParams: Promise<{
    next?: string | string[];
    password?: string | string[];
  }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const [query, viewer] = await Promise.all([searchParams, loadViewer()]);
  const passwordUpdated = (Array.isArray(query.password) ? query.password[0] : query.password) === "updated";
  if (passwordUpdated) redirect("/settings?password=updated#account");
  if (viewer.authenticated) redirect("/settings#account");

  const requestedNext = Array.isArray(query.next) ? query.next[0] : query.next;
  const nextPath = safeNextPath(requestedNext);

  return (
    <main className="center-page">
      <section className="auth-card account-gateway-card">
        <Link className="icon-button account-gateway-close" href="/" aria-label="Back to Busted Minds AI" title="Back to Busted Minds AI">
          <X aria-hidden size={19} />
        </Link>

        <div className="account-relationship" aria-label="Busted Minds AI connects to Busted Minds Account">
          <ThemeLogo size={42} priority />
          <ArrowRight aria-hidden size={16} />
          <Image className="account-relationship-logo" src={accountLogo} alt="Busted Minds Account" priority />
        </div>

        <span className="eyebrow">One account for Chess and AI</span>
        <h1>Bring your Busted Minds Account.</h1>
        <p>
          Continue with the account you already use, or create one now. Your AI conversations and Chess activity remain separate.
        </p>

        <div className="account-gateway-actions">
          <Link className="account-provider-button" href={accountSignInHref(nextPath)}>
            <span className="account-provider-logo" aria-hidden="true">
              <Image src={accountLogo} alt="" />
            </span>
            <span>
              <strong>Continue with Busted Minds</strong>
              <small>Use an existing Busted Minds Account</small>
            </span>
            <ArrowRight aria-hidden size={18} />
          </Link>

          <div className="account-choice-divider"><span />First time here?<span /></div>

          <a className="account-create-button" href={accountRegistrationHref(nextPath)}>
            <UserPlus aria-hidden size={18} />
            Create a Busted Minds Account
          </a>
        </div>

        <div className="account-gateway-notes">
          <span><CheckCircle2 aria-hidden size={15} /> One username across Busted Minds apps</span>
          <span><LockKeyhole aria-hidden size={15} /> Password entry stays on accounts.bustedminds.org</span>
        </div>
      </section>
    </main>
  );
}
