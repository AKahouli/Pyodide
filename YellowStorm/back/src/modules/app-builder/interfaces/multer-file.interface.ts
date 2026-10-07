/**
 * Minimal multer upload shape used by the template admin endpoints. Declared
 * structurally (as elsewhere in the codebase) instead of depending on
 * `Express.Multer.File` so services can be unit tested with plain objects.
 */
export interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}