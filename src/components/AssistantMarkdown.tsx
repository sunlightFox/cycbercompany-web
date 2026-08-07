import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";

export default function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children, node: _node, ...props }) => {
            const child = isValidElement<{
              className?: string;
              children?: ReactNode;
            }>(children)
              ? children
              : null;

            if (child?.props.className?.split(" ").includes("language-mermaid")) {
              return <MermaidDiagram chart={String(child.props.children ?? "").trimEnd()} />;
            }

            return <pre {...props}>{children}</pre>;
          },
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
