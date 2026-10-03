/** Horizontal chunk size in blocks (X and Z). */
export const CHUNK_SIZE = 16;
/** Vertical world height in blocks. */
export const WORLD_HEIGHT = 128;
/** Ocean / sea surface level. */
export const SEA_LEVEL = 40;
/** Blocks per chunk. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
/** Lowest Y the player can fall to before being rescued. */
export const VOID_Y = -24;
