"use client";

import { NODE_CATALOG } from "@fin/model-schema";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListSubheader from "@mui/material/ListSubheader";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { LIBRARY_GROUPS, searchPresets, type NodePreset } from "@/lib/presets";
import { useEditor } from "@/store/editor-store";
import { categoryColors } from "@/theme/theme";
import { PRESET_MIME } from "./Canvas";

/** Adds a preset at the center of the visible canvas. */
export function useAddAtCenter() {
  const { screenToFlowPosition } = useReactFlow();
  const addPreset = useEditor((s) => s.addPreset);
  return (presetId: string) => {
    const rect = document.querySelector(".react-flow")?.getBoundingClientRect();
    const center = rect ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
    const jitter = () => Math.round((Math.random() - 0.5) * 60);
    addPreset(presetId, { x: center.x - 110 + jitter(), y: center.y - 40 + jitter() });
  };
}

export function NodeLibrary() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchPresets(query), [query]);
  const addAtCenter = useAddAtCenter();
  const searching = query.trim().length > 0;

  const item = (p: NodePreset) => (
    <Tooltip key={p.id} title={p.description} placement="right" enterDelay={400}>
      <ListItemButton
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PRESET_MIME, p.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => addAtCenter(p.id)}
        sx={{ py: 0.5, px: 1.5, gap: 1, borderRadius: 1, mx: 0.5, cursor: "grab" }}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: categoryColors[NODE_CATALOG[p.type].category] }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{p.label}</Typography>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary" }} noWrap>
            {p.description}
          </Typography>
        </Box>
      </ListItemButton>
    </Tooltip>
  );

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ p: 1.5, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search nodes (e.g. churn)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) addAtCenter(results[0].id);
            if (e.key === "Escape") setQuery("");
          }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { "aria-label": "Search nodes" } }}
        />
      </Box>
      <Box sx={{ overflowY: "auto", flex: 1, pb: 2 }}>
        {searching ? (
          results.length > 0 ? (
            <List dense disablePadding>{results.map(item)}</List>
          ) : (
            <Typography color="text.secondary" sx={{ px: 2, py: 1, fontSize: 13 }}>
              No nodes match “{query}”.
            </Typography>
          )
        ) : (
          LIBRARY_GROUPS.map((group) => (
            <List key={group} dense disablePadding subheader={<ListSubheader sx={{ lineHeight: "28px", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, bgcolor: "background.paper" }}>{group}</ListSubheader>}>
              {results.filter((p) => p.group === group).map(item)}
            </List>
          ))
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}>
        Drag onto the canvas, or click to add.
      </Typography>
    </Box>
  );
}
