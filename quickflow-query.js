/* Lossless source-grid lookup. Display images are never used for values. */
const QuickflowPixelLookup = (() => {
  const manifests = new Map(), tiles = new Map();
  function sourcePixel(dataset, latlng) {
    const crs = dataset.crs === 'EPSG:32636'
      ? '+proj=utm +zone=36 +datum=WGS84 +units=m +no_defs' : dataset.crs;
    const [x, y] = proj4('EPSG:4326', crs, [latlng.lng, latlng.lat]);
    const [a, b, c, d, e, f] = dataset.transform, det = a * e - b * d;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !det) return null;
    const col = Math.floor((e * (x - c) - b * (y - f)) / det);
    const row = Math.floor((-d * (x - c) + a * (y - f)) / det);
    return col >= 0 && row >= 0 && col < dataset.width && row < dataset.height
      ? { col, row } : null;
  }
  async function manifest(url) {
    if (!manifests.has(url)) {
      const pending = fetch(url).then(r => {
        if (!r.ok) throw Error('Quickflow lookup metadata could not be loaded.');
        return r.json();
      }).then(m => ({ ...m, tileSet: new Set(m.tiles) }));
      manifests.set(url, pending);
      pending.catch(() => manifests.delete(url));
    }
    return manifests.get(url);
  }
  async function lookup(dataset, latlng) {
    const pixel = sourcePixel(dataset, latlng);
    if (!pixel) return null;
    const m = await manifest(dataset.valueLookup);
    const tx = Math.floor(pixel.col / m.tileSize), ty = Math.floor(pixel.row / m.tileSize);
    const key = `${tx}_${ty}`;
    if (!m.tileSet.has(key)) return null; // Entire tile is source NoData.
    const url = new URL(`${key}.f32.gz`, new URL(dataset.valueLookup, document.baseURI)).href;
    if (!tiles.has(url)) {
      const pending = fetch(url).then(async r => {
        if (!r.ok) throw Error('Quickflow pixel data could not be loaded. Please retry.');
        const stream = r.body.pipeThrough(new DecompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        const width = Math.min(m.tileSize, dataset.width - tx * m.tileSize);
        const height = Math.min(m.tileSize, dataset.height - ty * m.tileSize);
        if (buffer.byteLength !== width * height * 4) throw Error('Invalid Quickflow lookup tile.');
        return { view: new DataView(buffer), width };
      });
      tiles.set(url, pending);
      pending.catch(() => tiles.delete(url));
      if (tiles.size > 8) tiles.delete(tiles.keys().next().value);
    }
    const tile = await tiles.get(url);
    const index = (pixel.row % m.tileSize) * tile.width + pixel.col % m.tileSize;
    const value = tile.view.getFloat32(index * 4, true);
    return Number.isFinite(value) && value !== dataset.nodata ? value : null;
  }
  function text(dataset, value) {
    return value === null ? 'No data available at this location.'
      : `Quickflow: ${value.toFixed(2)} ${dataset.units}`;
  }
  return { sourcePixel, lookup, text };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = QuickflowPixelLookup;
