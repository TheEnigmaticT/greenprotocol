import Link from 'next/link'
import { getAllPosts } from '@/lib/blog'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date(value))
}

export default function BlogIndexPage() {
  const posts = getAllPosts()

  return (
    <main className="blog-shell">
      <header className="blog-header">
        <Link className="blog-brand" href="/">GreenChemistry.ai</Link>
        <Link className="blog-back" href="/">← Main site</Link>
      </header>
      <section className="blog-intro">
        <p className="blog-kicker">FIELD NOTES</p>
        <h1>Science, systems, and greener decisions.</h1>
        <p>Notes from the development cycle at GreenChemistry.ai: where AI can compress the research loop, and where rigor still has to slow it down.</p>
      </section>
      <section className="blog-list" aria-label="Blog posts">
        {posts.map((post) => (
          <article className="blog-card" key={post.slug}>
            <p className="blog-date">{formatDate(post.date)}</p>
            <h2><Link href={`/blog/${post.slug}`}>{post.title}</Link></h2>
            <p>{post.excerpt}</p>
            <Link className="blog-read" href={`/blog/${post.slug}`}>Read the post →</Link>
          </article>
        ))}
      </section>
    </main>
  )
}
