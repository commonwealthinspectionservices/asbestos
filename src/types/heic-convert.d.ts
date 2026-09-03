// heic-convert ships no types of its own.
declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Buffer | ArrayBufferLike;
    format: "JPEG" | "PNG";
    quality?: number;
  }
  function convert(options: ConvertOptions): Promise<Uint8Array>;
  export default convert;
}
