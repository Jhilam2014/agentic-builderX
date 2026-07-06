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
        outline: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.28), 0 0 0 7px rgba(20, 184, 166, 0.16) !important;
        animation: builderx-reference-glow 1.1s ease-in-out infinite !important;
        cursor: crosshair !important;
      }
      .builderx-reference-selected {
        outline: 0 !important;
        border-radius: 10px !important;
        box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.34), 0 0 0 9px rgba(225, 29, 72, 0.14), 0 0 26px rgba(225, 29, 72, 0.26) !important;
        animation: builderx-reference-selected-glow 1.25s ease-in-out infinite !important;
      }
      .builderx-reference-mode * {
        cursor: crosshair !important;
      }
      @keyframes builderx-reference-glow {
        0%, 100% { box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25), 0 0 0 7px rgba(20, 184, 166, 0.12); }
        50% { box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.42), 0 0 0 11px rgba(20, 184, 166, 0.2); }
      }
      @keyframes builderx-reference-selected-glow {
        0%, 100% { box-shadow: 0 0 0 3px rgba(225, 29, 72, 0.3), 0 0 0 9px rgba(225, 29, 72, 0.12), 0 0 22px rgba(225, 29, 72, 0.2); }
        50% { box-shadow: 0 0 0 4px rgba(225, 29, 72, 0.48), 0 0 0 13px rgba(225, 29, 72, 0.18), 0 0 32px rgba(225, 29, 72, 0.32); }
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
