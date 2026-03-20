export function parseBrokenInput(value: string) {
  const parts = value.split(":");

  if (parts.length < 2) {
    return {
      ok: false,
      reason: "missing separator",
    };
  }

  return {
    ok: true,
    left: parts[0],
    right: parts[1],
  // missing closing braces on purpose
