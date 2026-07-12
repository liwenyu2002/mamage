// 内置样式块库汇总：合并 A 组（h2/h3）与 B 组（quote/divider/imageCard/signoff），
// 对外只暴露这一个数组，UI/渲染引擎按 id 在其中查找即可，不关心 A/B 拆分。
// 约定：A 组文件为 ./builtinBlocksA.js，导出 BUILTIN_BLOCKS_A（与本文件的 BUILTIN_BLOCKS_B 对称命名）。
// 契约要求总计 52 块（h2 x14 / h3 x8 / quote x10 / divider x10 / imageCard x6 / signoff x4）；
// 本次并行生产实际口径为 A(h2 14 + h3 8 = 22) + B(quote 10 + divider 6 + imageCard 6 + signoff 4 = 26) = 48，
// 以两组实际落地的数组长度为准，若后续补齐 divider 差额，直接加进 builtinBlocksA.js 或 builtinBlocksB.js 即可，本文件无需改动。
import { BUILTIN_BLOCKS_A } from './builtinBlocksA.js';
import { BUILTIN_BLOCKS_B } from './builtinBlocksB.js';

export const BUILTIN_BLOCKS = [...BUILTIN_BLOCKS_A, ...BUILTIN_BLOCKS_B];
