import { Home } from "@/components/home/Home";

export default async function Page({ searchParams }: PageProps<"/">) {
  const { code } = await searchParams;
  const initialCode = typeof code === "string" ? code.replace(/\D/g, "").slice(0, 6) : "";
  return <Home initialCode={initialCode} />;
}
