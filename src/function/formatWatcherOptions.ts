import {
  Watcher,
} from 'yox-type/src/type'

import {
  WatcherOptions,
} from 'yox-type/src/options'

import * as is from 'yox-common/src/util/is'
import * as logger from 'yox-common/src/util/logger'
import * as constant from 'yox-common/src/util/constant'

// 避免频繁创建对象
const optionsHolder: WatcherOptions = {
  watcher: constant.EMPTY_FUNCTION,
}

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (
  options: Watcher | WatcherOptions | void,
  immediate: boolean | void
): WatcherOptions | void {

  const isWatcher = is.func(options)

  if (process.env.NODE_ENV === 'development') {
    if (!options
      || (!isWatcher && !(options as WatcherOptions).watcher)
    ) {
      logger.fatal(`watcher should be a Function or WatcherOptions.`)
    }
  }

  if (isWatcher) {
    optionsHolder.watcher = options as Watcher
    optionsHolder.immediate = immediate === constant.TRUE
    return optionsHolder
  }

  return options as WatcherOptions

}