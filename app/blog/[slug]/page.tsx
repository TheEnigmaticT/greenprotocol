import Link from 'next/link'
import { notFound } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getAllPosts, getPostBySlug } from '@/lib/blog'

export function generateStaticParams() {
  return getAllPosts().map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) return {}
  return {
    title: `${post.title} — GreenChemistry.ai`,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: 'article' },
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(value))
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = getPostBySlug(slug)
  if (!post) notFound()

  return (
    <main className="blog-shell blog-post-shell">
      <header className="blog-header">
        <Link className="blog-brand" href="/">GreenChemistry.ai</Link>
        <Link className="blog-back" href="/blog">← All posts</Link>
      </header>
      <article className="blog-post">
        <p className="blog-kicker">{formatDate(post.date)}</p>
        <h1>{post.title}</h1>
        <p className="blog-excerpt">{post.excerpt}</p>
        <div className="blog-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{post.body}</ReactMarkdown>
        </div>
      </article>
      <footer className="blog-footer">
        <Link href="/blog">← Back to the GreenChemistry.ai blog</Link>
      </footer>
    </main>
  )
}
