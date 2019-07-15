import {
  Watcher,
} from 'yox-type/src/type'

import {
  WatcherOptions,
} from 'yox-type/src/options'

import * as is from 'yox-common/src/util/is'
import * as env from 'yox-common/src/util/env'
import * as logger from 'yox-common/src/util/logger'

// 避免频繁创建对象
const optionsHolder: WatcherOptions = {
  watcher: env.EMPTY_FUNCTION
}

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (options: Watcher | WatcherOptions | void, immediate: boolean | void): WatcherOptions | void {

  if (is.func(options)) {
    optionsHolder.watcher = options as Watcher
    optionsHolder.immediate = immediate === env.TRUE
    return optionsHolder
  }

  if (options && (options as WatcherOptions).watcher) {
    return options as WatcherOptions
  }

  if (process.env.NODE_ENV === 'development') {
    logger.fatal(`watcher should be a function or object.`)
  }

}