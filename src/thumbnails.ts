import sharp from "sharp";

/** A run of identical half-block cells: `▀` drawn in `top` over a `bottom` background. */
export type ThumbnailRun = { top: string; bottom: string; length: number };
export type Thumbnail = { columns: number; rows: ThumbnailRun[][] };

/**
 * Shrinks an image into terminal cells. Each cell shows two pixels (upper and lower half), so a
 * preview of `maxRows` lines holds `maxRows * 2` pixel rows. Returns undefined for unreadable files.
 */
export async function renderThumbnail(path: string, maxColumns = 24, maxRows = 6): Promise<Thumbnail | undefined> {
  try {
    const { data, info } = await sharp(path, { animated: false })
      .resize({ width: maxColumns, height: maxRows * 2, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#0c0c0c" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): string => {
      if (y >= info.height) return "#0c0c0c";
      const offset = (y * info.width + x) * info.channels;
      return `#${[0, 1, 2].map(channel => data[offset + channel].toString(16).padStart(2, "0")).join("")}`;
    };
    const rows: ThumbnailRun[][] = [];
    for (let y = 0; y < info.height; y += 2) {
      const runs: ThumbnailRun[] = [];
      for (let x = 0; x < info.width; x++) {
        const top = pixel(x, y);
        const bottom = pixel(x, y + 1);
        const last = runs.at(-1);
        if (last && last.top === top && last.bottom === bottom) last.length++;
        else runs.push({ top, bottom, length: 1 });
      }
      rows.push(runs);
    }
    return { columns: info.width, rows };
  } catch { return undefined; }
}
