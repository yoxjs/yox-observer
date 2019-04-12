const patternCache = {}

/**
 * 模糊匹配 Keypath
 *
 * @param keypath
 * @param pattern
 */
export default function (keypath: string, pattern: string): boolean {
  let cache = patternCache[pattern]
  if (!cache) {
    cache = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    cache = patternCache[pattern] = new RegExp(`^${cache}$`)
  }
  return cache.test(keypath)
}