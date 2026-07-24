const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function decodeSourceBase64(value: unknown) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_SOURCE_BYTES * 4 / 3) + 8) {
    return null;
  }
  try {
    const binary = atob(value);
    if (!binary.length || binary.length > MAX_SOURCE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export const MAX_DATASET_SOURCE_BYTES = MAX_SOURCE_BYTES;
