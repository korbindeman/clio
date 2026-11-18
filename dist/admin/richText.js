import { Schema } from "prosemirror-model";
import { Plugin } from "prosemirror-state";
import { MarkdownParser, MarkdownSerializer, defaultMarkdownParser, defaultMarkdownSerializer, schema as markdownSchema, } from "prosemirror-markdown";
import { isAllowedLink, markdown } from "../markdown.js";
// The editor's document holds only what descriptions allow (see markdown.ts).
// Pasted headings, images and the like fall back to plain paragraphs.
const node = (name) => markdownSchema.spec.nodes.get(name);
const mark = (name) => markdownSchema.spec.marks.get(name);
export const schema = new Schema({
    nodes: {
        doc: node("doc"),
        paragraph: node("paragraph"),
        // Lists are always tight (no blank lines between items) when written.
        bullet_list: { ...node("bullet_list"), attrs: {} },
        ordered_list: { ...node("ordered_list"), attrs: { order: { default: 1 } } },
        list_item: node("list_item"),
        text: node("text"),
        hard_break: node("hard_break"),
    },
    marks: {
        em: mark("em"),
        strong: mark("strong"),
        link: {
            ...mark("link"),
            // Pasted links to anything but the web or email lose the link.
            parseDOM: [
                {
                    tag: "a[href]",
                    getAttrs: (dom) => {
                        const href = linkHref(dom.getAttribute("href"));
                        return href ? { href } : false;
                    },
                },
            ],
        },
    },
});
// Turns what an editor types into a link address, or null if it isn't one.
export function linkHref(input) {
    const value = input?.trim() ?? "";
    const href = /^[^\s@/:]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? `mailto:${value}`
        : /^[a-z][a-z0-9+.-]*:/i.test(value)
            ? value
            : `https://${value}`;
    return value && isAllowedLink(href) ? href : null;
}
const tokens = defaultMarkdownParser.tokens;
const parser = new MarkdownParser(schema, markdown, {
    paragraph: tokens.paragraph,
    bullet_list: tokens.bullet_list,
    ordered_list: tokens.ordered_list,
    list_item: tokens.list_item,
    em: tokens.em,
    strong: tokens.strong,
    link: tokens.link,
    hardbreak: tokens.hardbreak,
    softbreak: { node: "hard_break" },
});
const nodes = defaultMarkdownSerializer.nodes;
const serializer = new MarkdownSerializer({
    paragraph: nodes.paragraph,
    bullet_list: (state, node) => state.renderList(node, "  ", () => "- "),
    ordered_list: nodes.ordered_list,
    list_item: nodes.list_item,
    // A plain newline is a line break (see markdown.ts). Trailing breaks are dropped.
    hard_break(state, _node, parent, index) {
        for (let i = index + 1; i < parent.childCount; i++)
            if (parent.child(i).type !== schema.nodes.hard_break) {
                state.write("\n");
                return;
            }
    },
    // Text after a line break starts a line, so "- " must not become a list.
    text(state, node, parent, index) {
        const afterBreak = index > 0 && parent.child(index - 1).type === schema.nodes.hard_break;
        if (afterBreak)
            state.text(state.esc(node.text, true), false);
        else
            state.text(node.text);
    },
}, {
    em: defaultMarkdownSerializer.marks.em,
    strong: defaultMarkdownSerializer.marks.strong,
    link: {
        open: "[",
        close: (_state, mark) => `](${mark.attrs.href.replace(/[()]/g, "\\$&")})`,
    },
}, 
// "1) " at the start of a line would also begin a list.
{ escapeExtraCharacters: /(?<=^\s*\d+)\)(?=\s|$)/ });
export const parseMarkdown = (source) => parser.parse(source);
export const serializeMarkdown = (doc) => serializer.serialize(doc, { tightLists: true });
// Markdown merges neighbouring lists of one kind, so the editor does too.
export const joinLists = new Plugin({
    appendTransaction(transactions, _old, state) {
        if (!transactions.some((tr) => tr.docChanged))
            return null;
        const joins = [];
        state.doc.descendants((node, pos, parent, index) => {
            const list = [schema.nodes.bullet_list, schema.nodes.ordered_list];
            if (list.includes(node.type) &&
                index > 0 &&
                parent.child(index - 1).type === node.type)
                joins.push(pos);
        });
        if (!joins.length)
            return null;
        const tr = state.tr;
        for (const pos of joins.reverse())
            tr.join(pos);
        return tr;
    },
});
