<script lang="ts">
  // An ordered set of photos to arrange by hand: drag one onto another's
  // place (or use its arrows), take one out, drop new files anywhere on the
  // list or pick them with the add tile. The page owns the data; this only
  // reports what the editor did. Style it with the --image-list-* variables
  // or by targeting .image-list from the page.
  import { justifiedLayout } from "../gallery.js";
  import { IMAGE_TYPES, isImageFile } from "./uploadImage.js";

  interface ListItem {
    key: string;
    src: string;
    srcset?: string;
    // width / height; needed for the justified layout.
    ratio?: number;
    label?: string;
    placeholder?: string;
  }
  interface Props {
    items: ListItem[];
    // "strip": fixed-height tiles that wrap. "justified": rows that fill the width.
    layout?: "strip" | "justified";
    disabled?: boolean;
    selected?: string | null;
    addLabel?: string;
    // Shown on the first tile, e.g. "cover".
    firstLabel?: string;
    onreorder: (from: number, to: number) => void;
    onremove: (index: number) => void;
    onadd: (files: File[]) => void;
    onselect?: (key: string, index: number) => void;
  }
  let {
    items,
    layout = "strip",
    disabled = false,
    selected = null,
    addLabel = "Add photos",
    firstLabel,
    onreorder,
    onremove,
    onadd,
    onselect,
  }: Props = $props();

  let dragging = $state<number | null>(null);
  let over = $state<number | null>(null);
  let fileOver = $state(false);
  let input = $state<HTMLInputElement>();
  let width = $state(0);
  let gap = $state(12);

  const sizes = $derived(
    layout === "justified" && width
      ? justifiedLayout(
          items.map((i) => i.ratio ?? 1),
          width,
          gap,
          width <= 616 ? width / 2.5 : width / 6,
        )
      : null,
  );

  function measure(node: HTMLElement) {
    const update = () => {
      width = node.clientWidth;
      gap = parseFloat(getComputedStyle(node).columnGap) || 0;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
  const images = (files: FileList | null | undefined) =>
    [...(files ?? [])].filter(isImageFile);

  function dragStart(e: DragEvent, index: number) {
    if (disabled) return e.preventDefault();
    dragging = index;
    e.dataTransfer!.effectAllowed = "move";
    e.dataTransfer!.setData("text/plain", String(index));
  }
  function dragOver(e: DragEvent, index: number | null) {
    if (hasFiles(e)) {
      e.preventDefault();
      fileOver = true;
      return;
    }
    if (dragging === null) return;
    e.preventDefault();
    over = index;
  }
  function drop(e: DragEvent, index: number | null) {
    e.preventDefault();
    if (hasFiles(e)) {
      fileOver = false;
      const files = images(e.dataTransfer?.files);
      if (files.length && !disabled) onadd(files);
      return;
    }
    if (dragging !== null && index !== null && index !== dragging) onreorder(dragging, index);
    dragging = over = null;
  }
</script>

<div
  class="image-list"
  class:justified={layout === "justified"}
  class:file-over={fileOver}
  class:disabled
  role="list"
  use:measure
  ondragover={(e) => dragOver(e, null)}
  ondragleave={(e) => {
    if (e.currentTarget === e.target) fileOver = false;
  }}
  ondrop={(e) => drop(e, null)}
>
  {#each items as item, index (item.key)}
    <div
      class="tile"
      class:dragging={dragging === index}
      class:over={over === index && dragging !== index}
      class:selected={selected === item.key}
      role="listitem"
      draggable={!disabled}
      style:width={sizes ? `${Math.floor(sizes[index].width)}px` : undefined}
      style:height={sizes ? `${sizes[index].height}px` : undefined}
      style:--ratio={item.ratio ?? 1}
      style:background-image={item.placeholder ? `url("${item.placeholder}")` : undefined}
      ondragstart={(e) => dragStart(e, index)}
      ondragover={(e) => dragOver(e, index)}
      ondrop={(e) => drop(e, index)}
      ondragend={() => (dragging = over = null)}
    >
      <button
        type="button"
        class="pick"
        aria-label={item.label ?? `Photo ${index + 1}`}
        onclick={() => onselect?.(item.key, index)}
        tabindex={onselect ? 0 : -1}
      >
        <img src={item.src} srcset={item.srcset} sizes="240px" alt="" draggable="false" loading="lazy" />
      </button>
      {#if firstLabel && index === 0}<span class="first">{firstLabel}</span>{/if}
      <div class="tools">
        <button type="button" aria-label="Move earlier" disabled={disabled || index === 0} onclick={() => onreorder(index, index - 1)}>‹</button>
        <button type="button" aria-label="Move later" disabled={disabled || index === items.length - 1} onclick={() => onreorder(index, index + 1)}>›</button>
        <button type="button" class="remove" aria-label="Take this photo out" {disabled} onclick={() => onremove(index)}>×</button>
      </div>
    </div>
  {/each}
  <button type="button" class="tile add" {disabled} onclick={() => input?.click()}>
    <span class="plus" aria-hidden="true">+</span>
    <span>{addLabel}</span>
  </button>
  <input
    bind:this={input}
    type="file"
    accept={IMAGE_TYPES}
    multiple
    hidden
    onchange={(e) => {
      const files = images(e.currentTarget.files);
      e.currentTarget.value = "";
      if (files.length) onadd(files);
    }}
  />
</div>

<style>
  .image-list {
    --tile-h: var(--image-list-height, 140px);
    --line: var(--image-list-line, currentColor);
    display: flex;
    flex-wrap: wrap;
    gap: var(--image-list-gap, 12px);
    align-items: flex-start;
    padding: 6px;
    margin: -6px;
    outline: 2px dashed transparent;
    outline-offset: -2px;
  }
  .image-list.file-over {
    outline-color: var(--line);
  }
  .tile {
    position: relative;
    flex: none;
    height: var(--tile-h);
    width: calc(var(--tile-h) * var(--ratio));
    max-width: 100%;
    background-size: 100% 100%;
    cursor: grab;
  }
  .justified .tile {
    min-width: 0;
  }
  .tile.dragging {
    opacity: 0.35;
  }
  .tile.over {
    outline: 3px solid var(--line);
    outline-offset: 3px;
  }
  .tile.selected {
    outline: 3px solid var(--image-list-accent, #1f3dff);
    outline-offset: 3px;
  }
  .pick {
    all: unset;
    display: block;
    width: 100%;
    height: 100%;
  }
  .pick:focus-visible {
    outline: 2px solid var(--line);
    outline-offset: 2px;
  }
  .pick img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    -webkit-user-drag: none;
  }
  .first {
    position: absolute;
    left: 6px;
    top: 6px;
    padding: 1px 6px;
    font-size: 12px;
    background: var(--image-list-chip, #fff);
    color: #000;
  }
  .tools {
    position: absolute;
    right: 4px;
    bottom: 4px;
    display: flex;
    gap: 3px;
  }
  .tools button {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid #0006;
    border-radius: 50%;
    background: #fffe;
    color: #000;
    font: 16px/1 system-ui, sans-serif;
    cursor: pointer;
  }
  .tools button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .tools .remove {
    background: #fff;
    font-weight: 700;
  }
  .add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: var(--tile-h);
    border: 2px dashed var(--line);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .justified .add {
    height: var(--tile-h);
  }
  .add .plus {
    font-size: 32px;
    line-height: 1;
  }
  .disabled .tile {
    cursor: default;
  }
</style>
