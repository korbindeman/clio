<script lang="ts">
  import { onMount } from "svelte";
  import type { MarkType, NodeType } from "prosemirror-model";
  import {
    EditorState,
    Plugin,
    TextSelection,
    type Command,
  } from "prosemirror-state";
  import { EditorView } from "prosemirror-view";
  import "prosemirror-view/style/prosemirror.css";
  import { baseKeymap, toggleMark } from "prosemirror-commands";
  import { history, redo, undo } from "prosemirror-history";
  import { inputRules, wrappingInputRule } from "prosemirror-inputrules";
  import { keymap } from "prosemirror-keymap";
  import {
    liftListItem,
    splitListItem,
    wrapInList,
  } from "prosemirror-schema-list";
  import {
    joinLists,
    linkHref,
    parseMarkdown,
    schema,
    serializeMarkdown,
  } from "./richText";

  // A WYSIWYG field that reads and writes a Markdown description.
  let {
    label,
    value,
    maxlength,
    disabled = false,
    onchange,
  }: {
    label: string;
    value: string;
    maxlength: number;
    disabled?: boolean;
    onchange: (value: string) => void;
  } = $props();
  const id = $props.id();
  const { strong, em, underline, link } = schema.marks;
  const { bullet_list, ordered_list, list_item, hard_break } = schema.nodes;
  let element: HTMLDivElement;
  let view: EditorView | undefined;
  // The Markdown the editor shows, to tell outside changes (Undo, another
  // item) from the editor's own.
  let current = "";
  let active = $state({
    strong: false,
    em: false,
    underline: false,
    link: false,
    bullet: false,
    ordered: false,
  });
  let linking = $state(false);
  let href = $state("");
  let linkError = $state(false);
  let linkInput = $state<HTMLInputElement>();

  function markActive(state: EditorState, type: MarkType) {
    const { from, to, empty } = state.selection;
    return empty
      ? !!type.isInSet(state.storedMarks ?? state.selection.$from.marks())
      : state.doc.rangeHasMark(from, to, type);
  }
  // The innermost list around the cursor.
  function listAround(state: EditorState) {
    const position = state.selection.$from;
    for (let depth = position.depth; depth > 0; depth--) {
      const type = position.node(depth).type;
      if (type === bullet_list || type === ordered_list)
        return { pos: position.before(depth), type };
    }
    return null;
  }
  // The selection, or the whole link the cursor is in.
  function linkRange(state: EditorState) {
    const { from, to, empty } = state.selection;
    const position = state.selection.$from;
    const mark = link.isInSet(position.marks());
    const range = { from, to, href: (mark?.attrs.href as string) ?? "" };
    if (!empty || !mark) return range;
    const start = position.start();
    let runFrom = -1;
    let found = false;
    position.parent.forEach((child, offset) => {
      const childFrom = start + offset;
      const childTo = childFrom + child.nodeSize;
      if (!mark.isInSet(child.marks)) {
        runFrom = -1;
        found = false;
        return;
      }
      if (runFrom < 0) runFrom = childFrom;
      if (childFrom <= from && from <= childTo) {
        range.from = runFrom;
        found = true;
      }
      if (found) range.to = childTo;
    });
    return range;
  }

  const lineBreak: Command = (state, dispatch) => {
    dispatch?.(
      state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView(),
    );
    return true;
  };
  const toggleList =
    (type: NodeType): Command =>
    (state, dispatch) => {
      const list = listAround(state);
      if (!list) return wrapInList(type)(state, dispatch);
      if (list.type === type) return liftListItem(list_item)(state, dispatch);
      dispatch?.(state.tr.setNodeMarkup(list.pos, type));
      return true;
    };
  const tools = [
    { name: "Bold", state: "strong", command: toggleMark(strong) },
    { name: "Italic", state: "em", command: toggleMark(em) },
    { name: "Underline", state: "underline", command: toggleMark(underline) },
    { name: "List", state: "bullet", command: toggleList(bullet_list) },
    {
      name: "Numbered list",
      state: "ordered",
      command: toggleList(ordered_list),
    },
  ] as const;

  function createState(markdown: string) {
    return EditorState.create({
      doc: parseMarkdown(markdown),
      plugins: [
        history(),
        inputRules({
          rules: [
            wrappingInputRule(/^\s*[-*]\s$/, bullet_list),
            wrappingInputRule(/^1[.)]\s$/, ordered_list),
          ],
        }),
        keymap({
          "Mod-z": undo,
          "Shift-Mod-z": redo,
          "Mod-y": redo,
          "Mod-b": toggleMark(strong),
          "Mod-i": toggleMark(em),
          "Mod-u": toggleMark(underline),
          "Mod-k": () => (openLink(), true),
          "Shift-Enter": lineBreak,
          Enter: splitListItem(list_item),
        }),
        keymap(baseKeymap),
        joinLists,
        // Like a textarea's maxlength: refuse changes that make it too long.
        new Plugin({
          filterTransaction: (tr) =>
            !tr.docChanged ||
            serializeMarkdown(tr.doc).length <=
              Math.max(maxlength, current.length),
        }),
      ],
    });
  }
  function update() {
    if (!view) return;
    const list = listAround(view.state);
    active = {
      strong: markActive(view.state, strong),
      em: markActive(view.state, em),
      underline: markActive(view.state, underline),
      link: markActive(view.state, link),
      bullet: list?.type === bullet_list,
      ordered: list?.type === ordered_list,
    };
  }
  function run(command: Command) {
    if (!view) return;
    command(view.state, view.dispatch, view);
    view.focus();
  }

  function openLink() {
    if (!view || disabled) return;
    href = linkRange(view.state).href.replace(/^mailto:/, "");
    linkError = false;
    linking = true;
    queueMicrotask(() => linkInput?.focus());
  }
  function closeLink() {
    linking = false;
    view?.focus();
  }
  function applyLink() {
    if (!view) return;
    const target = linkHref(href);
    if (!target) {
      linkError = true;
      return;
    }
    const { from, to } = linkRange(view.state);
    const tr = view.state.tr;
    let end = to;
    // Without a selection, the address itself becomes the linked text.
    if (from === to) {
      tr.insertText(href.trim(), from);
      end = from + href.trim().length;
    }
    tr.removeMark(from, end, link)
      .addMark(from, end, link.create({ href: target }))
      .setSelection(TextSelection.create(tr.doc, end));
    view.dispatch(tr);
    closeLink();
  }
  function removeLink() {
    if (!view) return;
    const { from, to } = linkRange(view.state);
    view.dispatch(view.state.tr.removeMark(from, to, link));
    closeLink();
  }

  onMount(() => {
    current = value;
    view = new EditorView(element, {
      state: createState(current),
      editable: () => !disabled,
      attributes: {
        class: "rich-text rich-text-input",
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": `${id}-label`,
      },
      dispatchTransaction(tr) {
        if (!view) return;
        view.updateState(view.state.apply(tr));
        if (tr.docChanged) {
          current = serializeMarkdown(view.state.doc);
          onchange(current);
        }
        update();
      },
    });
    update();
    return () => view?.destroy();
  });
  $effect(() => {
    if (view && value !== current) {
      current = value;
      view.updateState(createState(value));
      linking = false;
      update();
    }
  });
  $effect(() => {
    view?.setProps({ editable: () => !disabled });
  });
</script>

<div class="rich-text-field">
  <p class="field-label" id={`${id}-label`}>{label}</p>
  <div
    class="rich-text-toolbar"
    role="toolbar"
    aria-label={`${label} formatting`}
  >
    {#each tools as tool (tool.name)}
      <button
        type="button"
        aria-pressed={active[tool.state]}
        {disabled}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => run(tool.command)}>{tool.name}</button
      >
    {/each}
    <button
      type="button"
      aria-pressed={active.link}
      aria-expanded={linking}
      {disabled}
      onmousedown={(e) => e.preventDefault()}
      onclick={openLink}>Link</button
    >
  </div>
  {#if linking}
    <div class="rich-text-link">
      <input
        bind:this={linkInput}
        bind:value={href}
        aria-label="Link address"
        aria-invalid={linkError}
        placeholder="example.com or name@example.com"
        oninput={() => (linkError = false)}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            applyLink();
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeLink();
          }
        }}
      />
      <button type="button" onclick={applyLink}>Apply</button>
      {#if active.link}<button type="button" onclick={removeLink}
          >Remove link</button
        >{/if}
      <button type="button" onclick={closeLink}>Cancel</button>
      {#if linkError}<small class="error" role="alert"
          >Use a web address or an email address.</small
        >{/if}
    </div>
  {/if}
  <div bind:this={element}></div>
  <small>Shift+Enter starts a new line within the same paragraph.</small>
</div>
