import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { ScrollArea } from '@/components/ui/scroll-area'

export default memo(function MarkdownPreview({ content }: { content: string }) {
  return (
    <ScrollArea className="h-full w-full">
      <div className="p-8 max-w-4xl mx-auto text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
            // Headings
            h1: ({ node, ...props }) => (
              <h1 {...props} className="text-3xl font-bold mt-8 mb-4 pb-2 border-b border-border first:mt-0" />
            ),
            h2: ({ node, ...props }) => (
              <h2 {...props} className="text-2xl font-semibold mt-6 mb-3" />
            ),
            h3: ({ node, ...props }) => (
              <h3 {...props} className="text-xl font-semibold mt-5 mb-2" />
            ),
            h4: ({ node, ...props }) => (
              <h4 {...props} className="text-lg font-semibold mt-4 mb-2" />
            ),
            h5: ({ node, ...props }) => (
              <h5 {...props} className="text-base font-semibold mt-3 mb-1" />
            ),
            h6: ({ node, ...props }) => (
              <h6 {...props} className="text-sm font-semibold mt-3 mb-1 text-muted-foreground" />
            ),

            // Paragraphs and text
            p: ({ node, ...props }) => (
              <p {...props} className="my-4 leading-relaxed text-base" />
            ),
            strong: ({ node, ...props }) => (
              <strong {...props} className="font-semibold" />
            ),
            em: ({ node, ...props }) => (
              <em {...props} className="italic" />
            ),
            del: ({ node, ...props }) => (
              <del {...props} className="line-through text-muted-foreground" />
            ),

            // Links
            a: ({ node, ...props }) => (
              <a
                {...props}
                className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                target="_blank"
                rel="noreferrer"
              />
            ),

            // Lists
            ul: ({ node, ...props }) => (
              <ul {...props} className="my-4 pl-6 list-disc space-y-2" />
            ),
            ol: ({ node, ...props }) => (
              <ol {...props} className="my-4 pl-6 list-decimal space-y-2" />
            ),
            li: ({ node, children, ...props }) => (
              <li {...props} className="leading-relaxed">
                {children}
              </li>
            ),

            // Task lists (checkboxes)
            input: ({ node, ...props }) => (
              <input
                {...props}
                disabled
                className="mr-2 h-4 w-4 rounded border-border accent-primary"
              />
            ),

            // Code
            code: ({ node, className, children, ...props }) => {
              const isInline = !className
              if (isInline) {
                return (
                  <code
                    {...props}
                    className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground"
                  >
                    {children}
                  </code>
                )
              }
              return (
                <code {...props} className={className}>
                  {children}
                </code>
              )
            },
            pre: ({ node, ...props }) => (
              <pre
                {...props}
                className="my-4 overflow-x-auto rounded-lg bg-[#0d1117] p-4 text-sm"
              />
            ),

            // Blockquote
            blockquote: ({ node, ...props }) => (
              <blockquote
                {...props}
                className="my-4 border-l-4 border-muted-foreground/40 pl-4 italic text-muted-foreground"
              />
            ),

            // Horizontal rule
            hr: ({ node, ...props }) => (
              <hr {...props} className="my-8 border-border" />
            ),

            // Tables
            table: ({ node, ...props }) => (
              <div className="my-4 overflow-x-auto">
                <table {...props} className="min-w-full border-collapse" />
              </div>
            ),
            thead: ({ node, ...props }) => (
              <thead {...props} className="bg-muted/50" />
            ),
            tbody: ({ node, ...props }) => (
              <tbody {...props} className="divide-y divide-border" />
            ),
            tr: ({ node, ...props }) => (
              <tr {...props} className="border-b border-border" />
            ),
            th: ({ node, ...props }) => (
              <th
                {...props}
                className="px-4 py-3 text-left text-sm font-semibold border border-border"
              />
            ),
            td: ({ node, ...props }) => (
              <td {...props} className="px-4 py-3 text-sm border border-border" />
            ),

            // Images
            img: ({ node, ...props }) => (
              <img
                {...props}
                className="my-4 max-w-full h-auto rounded-lg"
                loading="lazy"
              />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </ScrollArea>
  )
})
