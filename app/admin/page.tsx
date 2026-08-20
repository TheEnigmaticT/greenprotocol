import Script from 'next/script'

export default function AdminPage() {
  return (
    <html lang="en">
      <head>
        <meta name="robots" content="noindex" />
        <title>Content Manager — GreenChemistry.ai</title>
      </head>
      <body>
        <Script
          src="https://unpkg.com/@sveltia/cms/dist/sveltia-cms.js"
          strategy="beforeInteractive"
          type="module"
        />
      </body>
    </html>
  )
}
