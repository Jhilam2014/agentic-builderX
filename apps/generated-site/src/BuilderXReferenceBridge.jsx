import { useEffect } from "react";

const selectableSelector = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[role='link']",
  "[data-ui-id]",
  "[data-testid]",
  "header",
  "nav",
  "main",
  "section",
  "article",
  "aside",
  "footer",
  "h1",
  "h2",
  "h3",
  "p",
  "li",
  "span"
].join(",");

function slug(value) {
  return String(value || "element")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "element";
}

function describeElement(element) {
  const explicitId = element.getAttribute("data-ui-id") || element.id || element.getAttribute("data-testid");
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) ||
    element.getAttribute("placeholder") ||
    element.tagName.toLowerCase();
  if (!element.dataset.builderxUiId) {
    const all = Array.from(document.querySelectorAll(selectableSelector));
    const index = Math.max(1, all.indexOf(element) + 1);
    element.dataset.builderxUiId = explicitId ? slug(explicitId) : `ui-${element.tagName.toLowerCase()}-${slug(label)}-${index}`;
  }
  return {
    id: element.dataset.builderxUiId,
    tag: element.tagName.toLowerCase(),
    label,
    classes: element.className && typeof element.className === "string" ? element.className : ""
  };
}

export default function BuilderXReferenceBridge() {
  useEffect(() => {
    let enabled = false;
    let hoverElement = null;
    let selectedElement = null;
    const style = document.createElement("style");
    style.textContent = `
      .builderx-reference-hover {
        outline: 2px dotted #2563eb !important;
        outline-offset: 3px !important;
        cursor: crosshair !important;
      }
      .builderx-reference-selected {
        outline: 3px dotted #e11d48 !important;
        outline-offset: 4px !important;
        box-shadow: 0 0 0 5px rgba(225, 29, 72, 0.16) !important;
      }
      .builderx-reference-mode * {
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);

    const clearHover = () => {
      hoverElement?.classList.remove("builderx-reference-hover");
      hoverElement = null;
    };

    const setMode = (nextEnabled) => {
      enabled = nextEnabled;
      document.documentElement.classList.toggle("builderx-reference-mode", enabled);
      if (!enabled) clearHover();
    };

    const targetForEvent = (event) => {
      if (!enabled) return null;
      return event.target?.closest?.(selectableSelector);
    };

    const onMouseOver = (event) => {
      const target = targetForEvent(event);
      if (!target || target === hoverElement) return;
      clearHover();
      hoverElement = target;
      hoverElement.classList.add("builderx-reference-hover");
    };

    const onClick = (event) => {
      const target = targetForEvent(event);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectedElement?.classList.remove("builderx-reference-selected");
      selectedElement = target;
      selectedElement.classList.add("builderx-reference-selected");
      clearHover();
      const reference = describeElement(target);
      window.parent?.postMessage({ type: "builderx-ui-reference-selected", reference }, "*");
      setMode(false);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMode(false);
        window.parent?.postMessage({ type: "builderx-ui-reference-cancelled" }, "*");
      }
    };

    const onMessage = (event) => {
      if (event.data?.type === "builderx-reference-mode") setMode(Boolean(event.data.enabled));
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      setMode(false);
      selectedElement?.classList.remove("builderx-reference-selected");
      style.remove();
      window.removeEventListener("message", onMessage);
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}
