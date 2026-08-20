import fs from 'node:fs'
import path from 'node:path'

export type BlogPost = {
  title: string
  slug: string
  date: string
  excerpt: string
  draft: boolean
  body: string
}

const postsDirectory = path.join(process.cwd(), 'content', 'blog')

function parseFrontmatter(source: string): { metadata: Record<string, string>; body: string } {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) return { metadata: {}, body: source.trim() }

  const metadata: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    metadata[key] = value
  }

  return { metadata, body: match[2].trim() }
}

function readPost(filename: string): BlogPost {
  const source = fs.readFileSync(path.join(postsDirectory, filename), 'utf8')
  const { metadata, body } = parseFrontmatter(source)
  return {
    title: metadata.title ?? '',
    slug: metadata.slug ?? filename.replace(/\.md$/, ''),
    date: metadata.date ?? '',
    excerpt: metadata.excerpt ?? '',
    draft: metadata.draft === 'true',
    body,
  }
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(postsDirectory)) return []
  return fs.readdirSync(postsDirectory)
    .filter((filename) => filename.endsWith('.md'))
    .map(readPost)
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return getAllPosts().find((post) => post.slug === slug)
}
