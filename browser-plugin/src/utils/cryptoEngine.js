export async function generateLocalKey() {
  return await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKeyAsBase64(cryptoKey) {
  const rawKey = await crypto.subtle.exportKey("raw", cryptoKey);
  return bufferToBase64(new Uint8Array(rawKey));
}

export async function gzipCompress(bytes) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("CompressionStream (gzip) is not available in this browser.");
  }

  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gzipDecompress(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream (gzip) is not available in this browser.");
  }

  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encryptManifest(rawJsonManifest, cryptoKey) {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(rawJsonManifest));
  const compressedBytes = await gzipCompress(jsonBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encryptedBlob = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    compressedBytes
  );

  const finalizedBuffer = new Uint8Array(iv.length + encryptedBlob.byteLength);
  finalizedBuffer.set(iv, 0);
  finalizedBuffer.set(new Uint8Array(encryptedBlob), iv.length);
  return finalizedBuffer;
}

export async function decryptManifestBytes(encryptedBuffer, cryptoKey, payloadCompression = "gzip") {
  const bytes =
    encryptedBuffer instanceof Uint8Array
      ? encryptedBuffer
      : new Uint8Array(encryptedBuffer);

  if (bytes.length <= 12) {
    throw new Error("Encrypted payload is too short to contain IV + ciphertext.");
  }

  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
  const decryptedBytes = new Uint8Array(decryptedBuffer);

  if (payloadCompression === "gzip") {
    return gzipDecompress(decryptedBytes);
  }

  return decryptedBytes;
}

export async function computeStateHash(encryptedBuffer) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", encryptedBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
