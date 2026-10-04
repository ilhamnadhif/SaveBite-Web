import { notFound } from "next/navigation";
import { matchRoute } from "../../lib/routes";

/**
 * Every app URL lands here. The page renders nothing: `SaveBiteApp` in the
 * root layout rebuilds the screen from the URL. Unknown paths still return a
 * real 404 status.
 */
export default async function AppRoute({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const pathname = `/${slug.map((segment) => encodeURIComponent(segment)).join("/")}`;
  if (!matchRoute(pathname)) notFound();
  return null;
}
