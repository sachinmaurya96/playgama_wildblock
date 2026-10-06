/** UI-only icon caches. Reading a thumbnail must not load the 3D engine. */
export const itemIconUrls = new Map<string, string>();
export const catalogIconUrls = new Map<string, string>();

export function getIcon(item: string): string {
  return itemIconUrls.get(item) ?? '';
}

export function catalogIcon(id: string): string | undefined {
  return catalogIconUrls.get(id);
}
