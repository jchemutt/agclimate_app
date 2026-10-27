import Dashboard from "@/components/Dashboard";

type Params = Promise<{ country: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function CountryPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { country } = await params;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  // the query is passed in so the server and the browser render the same first frame
  return <Dashboard country={country} query={{ lang: one("lang"), run: one("run"), layer: one("layer"), by: one("by"), period: one("period") }} />;
}
