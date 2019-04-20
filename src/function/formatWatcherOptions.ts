import * as is from 'yox-common/src/util/is'
import * as env from 'yox-common/src/util/env'
import * as object from 'yox-common/src/util/object'

import WatcherOptions from 'yox-type/src/options/Watcher'

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (options: boolean | WatcherOptions | void): WatcherOptions {
  // 这里要返回全新的对象，避免后续的修改会影响外部传入的配置对象
  return options === env.TRUE
    ? { immediate: env.TRUE }
    : is.object(options)
      ? object.copy(options)
      : { }
}