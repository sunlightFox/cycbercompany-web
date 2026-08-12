export function safeExternalUrl(value?: string) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
