type Attributes = Record<string, string>;

/** Tiny helper for building DOM without innerHTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
  attributes?: Attributes,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attributes) {
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  }
  return node;
}
