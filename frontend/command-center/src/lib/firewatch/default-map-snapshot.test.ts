import { describe, expect, it } from "vitest";
import { isDefaultSnapshotScope, loadDefaultSnapshot } from "./default-map-snapshot";

const query = "year=2022&month=1&detection_type=vegetation";
describe("default archive snapshot", () => {
  it("loads the prepared default scope with exact cluster totals and no raw records", async () => {
    const snapshot = await loadDefaultSnapshot(query);
    expect(snapshot?.version).toMatch(/^[a-f0-9]{16}$/);
    expect(snapshot?.schema_version).toBe(1);
    expect(snapshot?.dashboard.observations).toEqual([]);
    for (const map of Object.values(snapshot!.maps)) {
      expect(map.clusters.reduce((sum: number, point: any) => sum + point.count, 0)).toBe(
        map.total,
      );
    }
  });
  it.each([
    "year=2023&month=1&detection_type=vegetation",
    "year=2022&month=2&detection_type=vegetation",
    "year=2022&month=1&detection_type=all",
    "year=2022&month=1",
    query + "&region=Bali",
    query + "&daynight=N",
    query + "&start_date=2022-01-02",
  ])("never substitutes the default snapshot for a different scope: %s", async (scope) => {
    expect(isDefaultSnapshotScope(scope)).toBe(false);
    expect(await loadDefaultSnapshot(scope)).toBeNull();
  });
});
