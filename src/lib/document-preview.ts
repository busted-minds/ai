import "server-only";

import * as mammoth from "mammoth";
import type { SupportedDocumentMimeType } from "./attachment-constants";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function previewShell(name: string, content: string, className: string) {
  const safeName = escapeHtml(name);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeName}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, Helvetica, sans-serif; }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: #303236; }
    body { min-height: 100vh; margin: 0; padding: 28px clamp(16px, 4vw, 56px) 70px; background: #303236; color: #18202a; }
    .document-page { width: min(816px, 100%); min-height: 1056px; margin: 0 auto; padding: clamp(42px, 8vw, 78px); overflow-wrap: anywhere; background: #fff; box-shadow: 0 4px 22px rgba(0, 0, 0, .32); font-size: 16px; line-height: 1.62; }
    .document-page > :first-child { margin-top: 0; }
    .document-page > :last-child { margin-bottom: 0; }
    h1, h2, h3, h4 { margin: 1.45em 0 .55em; color: #10284b; line-height: 1.22; }
    h1 { font-size: 2em; } h2 { font-size: 1.55em; border-bottom: 1px solid #b9c5d5; padding-bottom: .3em; } h3 { font-size: 1.22em; }
    p { margin: .72em 0; }
    a { color: #1268b3; }
    img { max-width: 100%; height: auto; }
    table { width: 100%; margin: 1.2em 0; border-collapse: collapse; }
    th, td { padding: 9px 11px; border: 1px solid #c8ced6; text-align: left; vertical-align: top; }
    th { background: #edf3f9; color: #10284b; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 14px/1.62 ui-monospace, SFMono-Regular, Consolas, monospace; tab-size: 2; }
    .plain-text { padding: clamp(38px, 7vw, 68px); }
    @media (max-width: 640px) {
      body { padding: 12px 8px 36px; }
      .document-page { min-height: calc(100vh - 48px); padding: 30px 24px; font-size: 14px; }
    }
  </style>
</head>
<body>
  <main class="document-page ${className}" aria-label="Preview of ${safeName}">${content}</main>
</body>
</html>`;
}

function decodeUtf8(bytes: Buffer) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function renderDocumentPreview(
  bytes: Buffer,
  mimeType: SupportedDocumentMimeType,
  name: string,
) {
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.convertToHtml(
      { buffer: bytes },
      { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
    );
    const content = result.value.trim() || "<p>This document has no previewable content.</p>";
    return previewShell(name, content, "docx-document");
  }

  let text = decodeUtf8(bytes);
  if (mimeType === "application/json") {
    text = JSON.stringify(JSON.parse(text), null, 2);
  }
  return previewShell(name, `<pre>${escapeHtml(text)}</pre>`, "plain-text");
}
