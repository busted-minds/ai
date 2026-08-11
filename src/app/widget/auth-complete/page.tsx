import type { Metadata } from "next";
import { WidgetAuthComplete } from "@/components/widget-auth-complete";

export const metadata: Metadata = {
  title: "Authentication complete",
  robots: { index: false, follow: false },
};

export default function WidgetAuthCompletePage() {
  return <WidgetAuthComplete />;
}
