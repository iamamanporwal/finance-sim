"use client";

import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown for AI answers: paragraphs, headings, bullet lists, tables,
 * **bold** and `code`. Produces React elements only — model output is never
 * injected as HTML.
 */
export function SafeMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) rows.push(cells);
        i++;
      }
      blocks.push(
        <Box key={blocks.length} component="table" sx={{ borderCollapse: "collapse", my: 1, fontSize: 13, "& td, & th": { border: 1, borderColor: "divider", px: 1, py: 0.5, textAlign: "left" } }}>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (ri === 0 ? <th key={ci}>{inline(c)}</th> : <td key={ci} className="num">{inline(c)}</td>))}
              </tr>
            ))}
          </tbody>
        </Box>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*([-*•]|\d+\.)\s+/, ""));
      blocks.push(
        <Box key={blocks.length} component="ul" sx={{ pl: 2.5, my: 0.5 }}>
          {items.map((it, k) => (
            <Typography key={k} component="li" variant="body2" sx={{ mb: 0.25 }}>
              {inline(it)}
            </Typography>
          ))}
        </Box>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <Typography key={blocks.length} variant="body2" sx={{ fontWeight: 700, mt: 1 }}>
          {inline(heading[2]!)}
        </Typography>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.trim().startsWith("|") && !/^\s*([-*•]|\d+\.)\s+/.test(lines[i]!) && !/^#{1,4}\s/.test(lines[i]!)) para.push(lines[i++]!);
    blocks.push(
      <Typography key={blocks.length} variant="body2" sx={{ my: 0.5, lineHeight: 1.6 }}>
        {inline(para.join(" "))}
      </Typography>,
    );
  }
  return <Box>{blocks}</Box>;
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
      return (
        <Box key={i} component="code" sx={{ fontSize: 12, bgcolor: "action.hover", px: 0.5, borderRadius: 0.5 }}>
          {p.slice(1, -1)}
        </Box>
      );
    return <Fragment key={i}>{p}</Fragment>;
  });
}
