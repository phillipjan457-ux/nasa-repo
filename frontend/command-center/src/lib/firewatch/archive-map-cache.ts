// Successful viewports survive navigation; old snapshots expire after five minutes.
export type CachedMap = {
  scope: string;
  zoom: number;
  west: number;
  east: number;
  south: number;
  north: number;
  expiresAt: number;
  result: any;
};
export const archiveMapCache: CachedMap[] = [];
