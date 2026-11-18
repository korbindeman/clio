import MarkdownIt from "markdown-it";

// Descriptions are Markdown limited to what the admin editor writes:
// paragraphs, line breaks, bold, italic, underline (++text++), links and
// lists. Raw HTML is escaped,
// and a single newline is a line break so plain-text descriptions keep theirs.
export const markdown = MarkdownIt("zero", { breaks: true }).enable([
  "list",
  "emphasis",
  "link",
  "newline",
  "escape",
]);

// ++text++ is underlined, read like ~~strikethrough~~ in markdown-it.
const PLUS = 0x2b;
type Inline = Parameters<Parameters<typeof markdown.inline.ruler.push>[1]>[0];
type Delimiter = Inline["delimiters"][number];
markdown.inline.ruler.push("underline", (state, silent) => {
  if (silent || state.src.charCodeAt(state.pos) !== PLUS) return false;
  const scanned = state.scanDelims(state.pos, true);
  let length = scanned.length;
  if (length < 2) return false;
  if (length % 2) {
    state.push("text", "", 0).content = "+";
    length--;
  }
  for (let i = 0; i < length; i += 2) {
    state.push("text", "", 0).content = "++";
    state.delimiters.push({
      marker: PLUS,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }
  state.pos += scanned.length;
  return true;
});
function underlinePairs(state: Inline, delimiters: Delimiter[]) {
  const lone: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== PLUS || start.end === -1) continue;
    const end = delimiters[start.end];
    Object.assign(state.tokens[start.token], {
      type: "u_open",
      tag: "u",
      nesting: 1,
      markup: "++",
      content: "",
    });
    Object.assign(state.tokens[end.token], {
      type: "u_close",
      tag: "u",
      nesting: -1,
      markup: "++",
      content: "",
    });
    const before = state.tokens[end.token - 1];
    if (before.type === "text" && before.content === "+") lone.push(end.token - 1);
  }
  // A leftover "+" belongs outside the closing tags: "+++a+++" is "+<u>a</u>+".
  while (lone.length) {
    const i = lone.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === "u_close") j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}
markdown.inline.ruler2.before("fragments_join", "underline", (state) => {
  underlinePairs(state, state.delimiters);
  for (const meta of state.tokens_meta)
    if (meta?.delimiters) underlinePairs(state, meta.delimiters);
  return false;
});

export const isAllowedLink = (href: string) =>
  /^(https?:\/\/|mailto:)\S+$/i.test(href);
// A link to anything else stays as its literal Markdown text.
markdown.validateLink = isAllowedLink;
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  if (/^https?:/i.test(tokens[index].attrGet("href") ?? "")) {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer");
  }
  return self.renderToken(tokens, index, options);
};

export function renderMarkdown(source: string) {
  return markdown.render(source);
}

// The words alone, for captions and meta descriptions.
export function markdownText(source: string) {
  return markdown
    .parse(source, {})
    .filter((token) => token.type === "inline")
    .map((inline) =>
      (inline.children ?? [])
        .map((token) =>
          token.type === "text"
            ? token.content
            : token.type.endsWith("break")
              ? " "
              : "",
        )
        .join(""),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
