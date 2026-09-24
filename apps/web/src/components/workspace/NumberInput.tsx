"use client";

import InputAdornment from "@mui/material/InputAdornment";
import TextField, { type TextFieldProps } from "@mui/material/TextField";
import { useEffect, useState } from "react";

const DISPLAY_DIGITS = 10;

/** Shows a value, optionally scaled (percent fractions ×100), committing on blur or Enter. */
export function NumberInput({
  value,
  onCommit,
  scale = 1,
  prefix,
  suffix,
  error,
  helperText,
  ...rest
}: {
  value: number | undefined;
  onCommit(value: number | undefined): void;
  scale?: number;
  prefix?: string;
  suffix?: string;
} & Omit<TextFieldProps, "value" | "onChange">) {
  const toText = (v: number | undefined) => (v === undefined ? "" : String(Number((v * scale).toPrecision(DISPLAY_DIGITS))));
  const [text, setText] = useState(toText(value));
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!focused) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, scale, focused]);

  const commit = () => {
    const cleaned = text.replace(/[,_\s$₹%]/g, "");
    if (cleaned === "") {
      setInvalid(false);
      onCommit(undefined);
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(Number((n / scale).toPrecision(15)));
  };

  return (
    <TextField
      size="small"
      {...rest}
      value={text}
      error={invalid || error}
      helperText={invalid ? "Enter a number" : helperText}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(toText(value));
          setInvalid(false);
        }
      }}
      slotProps={{
        ...rest.slotProps,
        htmlInput: { inputMode: "decimal", className: "num", ...(rest.slotProps?.htmlInput as object | undefined) },
        input: {
          startAdornment: prefix ? <InputAdornment position="start">{prefix}</InputAdornment> : undefined,
          endAdornment: suffix ? <InputAdornment position="end">{suffix}</InputAdornment> : undefined,
        },
      }}
    />
  );
}

/** Display scaling and adornments for a unit string. */
export function unitPresentation(unit: string): { scale: number; prefix?: string; suffix?: string } {
  if (unit === "percent") return { scale: 100, suffix: "%" };
  const [head, per] = unit.split("/");
  const perText = per ? `/${per.replace(/s$/, "")}` : undefined;
  if (head === "USD") return { scale: 1, prefix: "$", suffix: perText };
  if (head === "INR") return { scale: 1, prefix: "₹", suffix: perText };
  if (!unit || unit === "number") return { scale: 1 };
  return { scale: 1, suffix: unit };
}

/** Text field that commits on blur/Enter; `required` fields revert when left empty. */
export function TextInput({
  value,
  onCommit,
  required,
  ...rest
}: { value: string; onCommit(value: string): void; required?: boolean } & Omit<TextFieldProps, "value" | "onChange">) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  const commit = () => {
    const t = text.trim();
    if (required && !t) {
      setText(value);
      return;
    }
    if (t !== value) onCommit(t);
  };
  return (
    <TextField
      size="small"
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !rest.multiline) (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value);
      }}
    />
  );
}
