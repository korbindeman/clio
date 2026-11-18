import MarkdownIt from "markdown-it";
export declare const markdown: MarkdownIt;
export declare const isAllowedLink: (href: string) => boolean;
export declare function renderMarkdown(source: string): string;
export declare function markdownText(source: string): string;
