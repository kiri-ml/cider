/** Shared constants for the MapleLegends cyan glyph decoder. */

export const GLYPH_HEIGHT = 12;
export const COLUMN_BITS = 12;
export const GLYPH_ORIGIN_X = 73;

export const CYAN_R = 102;
export const CYAN_G = 204;
export const CYAN_B = 255;

export const CHARSET_SPACE = " ";
export const CHARSET_NUMERIC = "0123456789";
export const CHARSET_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
export const CHARSET_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const CHARSET_ALPHABETIC = CHARSET_LOWERCASE + CHARSET_UPPERCASE;
export const CHARSET_ALPHANUMERIC = CHARSET_NUMERIC + CHARSET_ALPHABETIC;
export const CHARSET_SPACED_ALPHANUMERIC = CHARSET_SPACE + CHARSET_ALPHANUMERIC;
export const CHARSET_TIMESTAMP = CHARSET_NUMERIC + "[:]";
export const CHARSET_PRINTABLE_ASCII = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("");
