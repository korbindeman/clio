import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownText, renderMarkdown } from "../src/markdown.ts";
import { EditorState } from "prosemirror-state";
import {
  joinLists,
  linkHref,
  parseMarkdown,
  schema,
  serializeMarkdown,
} from "../src/admin/richText.ts";

test("descriptions render paragraphs, line breaks, emphasis, links and lists", () => {
  assert.equal(
    renderMarkdown(
      "Made for *Roffa* on the **Rocks**.\nHosted by [Bar Break](https://example.com).\n\n- Rice\n- Coconut\n\n1. Shake",
    ),
    '<p>Made for <em>Roffa</em> on the <strong>Rocks</strong>.<br>\nHosted by <a href="https://example.com" target="_blank" rel="noreferrer">Bar Break</a>.</p>\n' +
      "<ul>\n<li>Rice</li>\n<li>Coconut</li>\n</ul>\n<ol>\n<li>Shake</li>\n</ol>\n",
  );
});
test("descriptions never render HTML, headings, images or unsafe links", () => {
  assert.equal(
    renderMarkdown(
      "<script>alert(1)</script>\n# Title\n[x](javascript:alert(1))",
    ),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;<br>\n# Title<br>\n[x](javascript:alert(1))</p>\n",
  );
  assert.doesNotMatch(
    renderMarkdown("![x](https://example.com/x.jpg)"),
    /<img/,
  );
  assert.equal(
    renderMarkdown("[mail](mailto:name@example.com)"),
    '<p><a href="mailto:name@example.com">mail</a></p>\n',
  );
});
test("plain text keeps only the words", () => {
  assert.equal(
    markdownText(
      "A *short* [film](https://example.com).\nDirector: D\n\n- One\n- Two",
    ),
    "A short film. Director: D One Two",
  );
});

test("the editor reads and writes the same Markdown", () => {
  for (const source of [
    "",
    "My entry for the *Nikka Perfect Serve* finals.\n\nTopped with a **chewy** rice foam.",
    "Director: Name\nCamera: Name\nMusic: *Untitled*",
    "See [the album](https://example.com/a_\\(b\\)) and ***both***.",
    "- Rice\n- Black sesame\n\nAfter the list.\n\n1. One\n2. Two",
    "snake_case, 3 \\* 4, a \\* star and a \\[bracket\\].",
  ])
    assert.equal(serializeMarkdown(parseMarkdown(source)), source);
});
test("text that looks like Markdown stays text through the editor", () => {
  const { paragraph, hard_break } = schema.nodes;
  const lines = [
    "- not a list",
    "1) nor this",
    "2. nor this",
    "+ nor this",
    "*stars*",
  ];
  const doc = schema.node("doc", null, [
    paragraph.create(
      null,
      lines.flatMap((line, i) => [
        ...(i ? [hard_break.create()] : []),
        schema.text(line),
      ]),
    ),
  ]);
  const source = serializeMarkdown(doc);
  assert.ok(parseMarkdown(source).eq(doc), source);
  assert.equal(markdownText(source), lines.join(" "));
});
test("plain-text descriptions open unchanged", () => {
  const source =
    "Made for the “Roffa on the Rocks” competition hosted by Bar Break & Hinch Distillery.";
  assert.equal(serializeMarkdown(parseMarkdown(source)), source);
});

test("typed link addresses become web or email links", () => {
  assert.equal(linkHref(" example.com/a "), "https://example.com/a");
  assert.equal(linkHref("http://example.com"), "http://example.com");
  assert.equal(linkHref("name@example.com"), "mailto:name@example.com");
  assert.equal(linkHref("javascript:alert(1)"), null);
  assert.equal(linkHref("two words"), null);
  assert.equal(linkHref(""), null);
});
test("neighbouring lists of one kind join, as Markdown would render them", () => {
  const { bullet_list, ordered_list, list_item, paragraph } = schema.nodes;
  const item = (text: string) =>
    list_item.create(null, paragraph.create(null, schema.text(text)));
  const state = EditorState.create({
    doc: schema.node("doc", null, [paragraph.create()]),
    plugins: [joinLists],
  });
  const lists = [
    bullet_list.create(null, item("Rice")),
    bullet_list.create(null, item("Coconut")),
    ordered_list.create(null, item("Shake")),
  ];
  const next = state.applyTransaction(
    state.tr.replaceWith(0, state.doc.content.size, lists),
  ).state;
  assert.equal(serializeMarkdown(next.doc), "- Rice\n- Coconut\n\n1. Shake");
});
