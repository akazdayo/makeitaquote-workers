# Bundled font

`quote-font.bdf.gz` is the unmodified GNU Unifont Japanese 18.0.01 bitmap font:
https://unifoundry.com/pub/unifont/unifont-18.0.01/font-builds/unifont_jp-18.0.01.bdf.gz

SHA-256: `3a0ddf814f89990e84e229a69efdd5f5d7b15e07302865add8463ff7f6965acc`

Copyright (C) 1998-2026 Roman Czyborra, Paul Hardy, Qianqian Fang, Andrew Miller,
Johnnie Weaver, David Corbett, Ælla Chiana Moskopp, Rebecca Bettencourt, Minseo Lee,
Ho-Seok Ee, et al.

The font is dual-licensed under SIL Open Font License 1.1 and GPL version 2 or
later with the GNU font embedding exception. This project uses the font under
the SIL Open Font License 1.1. See `FONT-LICENSE.txt` for the full upstream terms.

`scripts/build-font.mjs` transforms its bitmap rows into the derived internal
QuoteRasterFont data (`src/font.bin`). This derived font data remains under the
same SIL Open Font License 1.1; it is not sold separately. Font licensing does
not apply to quote images produced using it or require the application code
to use the font's license.
