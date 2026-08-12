import { redirect } from "next/navigation";

type AccountPageProps = {
  searchParams: Promise<{ password?: string | string[] }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const query = await searchParams;
  const passwordUpdated = (Array.isArray(query.password) ? query.password[0] : query.password) === "updated";
  redirect(passwordUpdated ? "/settings?password=updated#account" : "/settings#account");
}
