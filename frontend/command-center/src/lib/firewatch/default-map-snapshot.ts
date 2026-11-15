export type DefaultMapSnapshot = {
  schema_version: number;
  version: string;
  generated_at: string;
  archive_processed_at: string | null;
  maps: Record<string, any>;
  dashboard: any;
};

export function isDefaultSnapshotScope(query: string) {
  const params = new URLSearchParams(query);
  const expected: Record<string, string> = {
    year: "2022",
    month: "1",
    detection_type: "vegetation",
  };
  return (
    Object.entries(expected).every(([key, value]) => params.get(key) === value) &&
    [...params.entries()].every(([key, value]) => expected[key] === value)
  );
}

export async function loadDefaultSnapshot(query: string): Promise<DefaultMapSnapshot | null> {
  if (!isDefaultSnapshotScope(query)) return null;
  // Vite serves this as a small, hashed chunk; the browser caches it across visits.
  const data = await import("@/data/default-map.json");
  return data.default as DefaultMapSnapshot;
}
