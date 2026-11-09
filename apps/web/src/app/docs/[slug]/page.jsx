import { notFound } from "next/navigation";
import { DOCS, DocsPage, docBySlug } from "@/features/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug).map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = docBySlug(slug);
  return { title: doc ? `${doc.title} · eSpace Hubs docs` : "Docs · eSpace Hubs" };
}

export default async function DocRoute({ params }) {
  const { slug } = await params;
  if (!docBySlug(slug)) notFound();
  return <DocsPage slug={slug} />;
}
