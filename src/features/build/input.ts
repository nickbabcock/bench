/**
 * The bytes the compression subjects encode and decode: the compression
 * page's Silesia files, so both pages measure the same inputs. Effects
 * depend on the data (zlib-rs level 1 gains far more from SIMD on source
 * code than on an X-ray), so the matrix runs English text, a binary image
 * and a source tarball.
 */
import type { CorpusId } from "@/features/compression/corpora";

export const BUILD_CORPORA: readonly CorpusId[] = ["dickens", "x-ray", "samba"];
