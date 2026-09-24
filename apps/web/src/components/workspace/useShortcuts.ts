"use client";

import { useEffect } from "react";
import { useEditor } from "@/store/editor-store";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Global editor shortcuts:
 * ⌘/Ctrl Z undo · ⌘⇧Z / ⌘Y redo · Delete/Backspace delete · ⌘C copy · ⌘V paste
 * ⌘D duplicate · ⌘S save · ⌘K command palette · ⌘Enter run
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (mod && key === "k") {
        e.preventDefault();
        s.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if (mod && key === "s") {
        e.preventDefault();
        s.save();
        s.notify("Saved in this browser.", "success");
        return;
      }
      if (mod && key === "enter") {
        e.preventDefault();
        s.run();
        s.setMode(useEditor.getState().simStatus === "ok" ? "results" : "simulate");
        return;
      }
      if (isTyping(e.target) || s.paletteOpen) return;

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        s.redo();
      } else if (s.mode !== "build") {
        return;
      } else if (key === "delete" || key === "backspace") {
        e.preventDefault();
        s.deleteSelection();
      } else if (mod && key === "c") {
        s.copySelection();
      } else if (mod && key === "v") {
        e.preventDefault();
        s.paste();
      } else if (mod && key === "d") {
        e.preventDefault();
        s.duplicateSelection();
      } else if (key === "escape") {
        s.select([], []);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
