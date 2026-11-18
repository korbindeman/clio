import MarkdownIt from "markdown-it";
// Descriptions are Markdown limited to what the admin editor writes:
// paragraphs, line breaks, bold, italic, links and lists. Raw HTML is escaped,
// and a single newline is a line break so plain-text descriptions keep theirs.
export const markdown = MarkdownIt("zero", { breaks: true }).enable([
    "list",
    "emphasis",
    "link",
    "newline",
    "escape",
]);
export const isAllowedLink = (href) => /^(https?:\/\/|mailto:)\S+$/i.test(href);
// A link to anything else stays as its literal Markdown text.
markdown.validateLink = isAllowedLink;
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
    if (/^https?:/i.test(tokens[index].attrGet("href") ?? "")) {
        tokens[index].attrSet("target", "_blank");
        tokens[index].attrSet("rel", "noreferrer");
    }
    return self.renderToken(tokens, index, options);
};
export function renderMarkdown(source) {
    return markdown.render(source);
}
// The words alone, for captions and meta descriptions.
export function markdownText(source) {
    return markdown
        .parse(source, {})
        .filter((token) => token.type === "inline")
        .map((inline) => (inline.children ?? [])
        .map((token) => token.type === "text"
        ? token.content
        : token.type.endsWith("break")
            ? " "
            : "")
        .join(""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}
