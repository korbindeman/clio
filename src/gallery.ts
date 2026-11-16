// A justified photo grid (from dariodecastro.com): complete rows fill the
// width; a short final row keeps its natural height.
export function justifiedLayout(
  ratios: number[],
  width: number,
  gap: number,
  targetHeight = width <= 616 ? width / 3.5 : width / 8,
) {
  const sizes: { width: number; height: number }[] = [];
  let start = 0;
  while (start < ratios.length) {
    let end = start;
    let sum = ratios[start];
    while (end + 1 < ratios.length) {
      const height = (width - (end - start) * gap) / sum;
      const nextHeight = (width - (end - start + 1) * gap) / (sum + ratios[end + 1]);
      if (Math.abs(height - targetHeight) <= Math.abs(nextHeight - targetHeight)) break;
      sum += ratios[++end];
    }
    const fittedHeight = (width - (end - start) * gap) / sum;
    const height = end === ratios.length - 1 ? Math.min(targetHeight, fittedHeight) : fittedHeight;
    for (let i = start; i <= end; i++) sizes.push({ width: ratios[i] * height, height });
    start = end + 1;
  }
  return sizes;
}

// Sizes each `[data-gallery-index]` child of `gallery` to the justified grid,
// now and on every resize. `targetHeight` picks the row height for a width.
export function setupGallery(
  gallery: HTMLElement,
  ratios: number[],
  targetHeight?: (width: number) => number,
) {
  if (typeof ResizeObserver === "undefined") return () => {};
  const stylesheet = document.createElement("style");
  gallery.appendChild(stylesheet);
  const scope = gallery.dataset.gallery ? `[data-gallery="${gallery.dataset.gallery}"]` : "[data-gallery]";
  function resize() {
    const width = gallery.clientWidth;
    if (!width) return;
    const gap = parseFloat(getComputedStyle(gallery).columnGap) || 0;
    const sizes = justifiedLayout(ratios, width, gap, targetHeight?.(width));
    stylesheet.textContent = sizes
      .map(
        (size, index) =>
          `${scope}>[data-gallery-index="${index}"]{width:${Math.floor(size.width * 100) / 100}px;height:${size.height}px}`,
      )
      .join("");
    gallery.querySelectorAll<HTMLImageElement>("[data-gallery-index] img").forEach((image, index) => {
      if (sizes[index]) image.sizes = `${Math.ceil(sizes[index].width)}px`;
    });
  }
  resize();
  let frame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(resize);
  });
  observer.observe(gallery);
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
