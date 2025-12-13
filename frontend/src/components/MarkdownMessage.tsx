import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="text-sm leading-tight space-y-0.5 [&_p]:my-0.5 [&_ul]:my-0 [&_ol]:my-0 [&_h1]:my-0 [&_h2]:my-0 [&_h3]:my-0 [&_blockquote]:my-0 [&_li>p]:my-0 [&_li]:leading-tight [&_li]:my-0.5 [&_li]:text-[14px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ node, ...props }) => <p {...props} className="break-words my-0.5" />,
          ul: ({ node, ...props }) => <ul {...props} className="list-disc list-inside pl-0" />,
          ol: ({ node, ...props }) => <ol {...props} className="list-decimal list-inside pl-0" />,
          li: ({ node, ...props }) => <li {...props} className="break-words my-0" />,
          a: ({ node, ...props }) => (
            <a {...props} className="break-words underline" target="_blank" rel="noreferrer" />
          ),
          code: (props) =>
            (props as any)?.inline ? (
              <code {...props} className="rounded bg-muted px-1 py-0.5" />
            ) : (
              <code {...props} className="block whitespace-pre overflow-x-auto text-xs p-2 my-1 rounded bg-muted" />
            ),
          pre: ({ node, ...props }) => (
            <pre {...props} className="max-w-full overflow-x-auto rounded bg-muted p-2 my-1" />
          ),
          h1: ({ node, ...props }) => <h1 {...props} className="text-base font-semibold mt-1 mb-0.5" />,
          h2: ({ node, ...props }) => <h2 {...props} className="text-base font-semibold mt-1 mb-0.5" />,
          h3: ({ node, ...props }) => <h3 {...props} className="text-sm font-semibold mt-1 mb-0.5" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}


