import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'

const immediateWatchOptions = { immediate: env.TRUE }

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (options: boolean | Record<string, any> | void): any {
  return options === env.TRUE
    ? immediateWatchOptions
    : is.object(options)
      ? options
      : env.EMPTY_OBJECT
}