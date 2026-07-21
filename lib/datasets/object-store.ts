export function datasetObjectKey(sha256: string) {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error("invalid_dataset_sha256");
  return `datasets/sha256/${sha256.slice(0, 2)}/${sha256}.csv`;
}

export async function persistDatasetSource(
  bucket: R2Bucket,
  bytes: Uint8Array,
  sha256: string,
) {
  const key = datasetObjectKey(sha256);
  const existing = await bucket.head(key);
  if (existing) {
    if (existing.size !== bytes.byteLength || existing.customMetadata?.sha256 !== sha256) {
      throw new Error("dataset_object_integrity_conflict");
    }
    return key;
  }
  const stored = await bucket.put(key, bytes, {
    httpMetadata: { contentType: "text/csv; charset=utf-8" },
    customMetadata: { sha256 },
  });
  if (stored.size !== bytes.byteLength || stored.customMetadata?.sha256 !== sha256) {
    throw new Error("dataset_object_write_unverified");
  }
  return key;
}

export async function readDatasetSource(bucket: R2Bucket, key: string, expectedSha256: string) {
  if (key !== datasetObjectKey(expectedSha256)) throw new Error("dataset_object_key_mismatch");
  const object = await bucket.get(key);
  if (!object || object.customMetadata?.sha256 !== expectedSha256) {
    throw new Error("dataset_object_missing_or_unverified");
  }
  return new Uint8Array(await object.arrayBuffer());
}
