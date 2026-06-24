// util/async-utils.js

/** 指定された時間（ミリ秒）だけ待機します。 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
