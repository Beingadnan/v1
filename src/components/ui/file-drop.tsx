"use client";

import { Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";

import { cn } from "@/lib/utils";

type FileDropProps = {
  /** e.g. ".xlsx,.xls,.csv" — checked again on the server; this is only a convenience. */
  accept: string;
  /** Plain description of what to drop, e.g. "Logger export (.xlsx, .xls or .csv)". */
  description: string;
  maxSizeMb: number;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Take many files at once; each accepted one is passed to onFile. */
  multiple?: boolean;
};

/**
 * Drag-and-drop or click-to-choose for a single file.
 * Client-side checks only give fast feedback; the server re-validates
 * type, size and content before anything is stored.
 */
export function FileDrop({
  accept,
  description,
  maxSizeMb,
  onFile,
  disabled,
  multiple,
}: FileDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(list: FileList | null | undefined) {
    const files = [...(list ?? [])].slice(0, multiple ? undefined : 1);
    if (files.length === 0) return;
    const allowed = accept.split(",").map((ext) => ext.trim().toLowerCase());
    const refused: string[] = [];
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (!allowed.some((ext) => name.endsWith(ext))) {
        refused.push(`${file.name} is not an accepted file type. Choose ${accept}.`);
      } else if (file.size > maxSizeMb * 1024 * 1024) {
        refused.push(`${file.name} is larger than ${maxSizeMb} MB. Split or compress it first.`);
      } else {
        onFile(file);
      }
    }
    setError(refused.length ? refused.join(" ") : null);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) handleFiles(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-surface px-6 py-8 text-center transition-colors hover:border-primary",
          dragging && "border-primary bg-brand-soft",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <Upload className="size-6 text-primary" aria-hidden="true" />
        <span className="text-sm font-medium">
          {multiple ? "Drop files here, or choose them" : "Drop a file here, or choose one"}
        </span>
        <span className="text-xs text-muted-foreground">
          {description} · up to {maxSizeMb} MB
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-fail">
          {error}
        </p>
      ) : null}
    </div>
  );
}
