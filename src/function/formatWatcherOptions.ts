import * as is from 'yox-common/src/util/is'
import * as env from 'yox-common/src/util/env'
import * as logger from 'yox-common/src/util/logger'

import * as type from 'yox-type/index'
import WatcherOptions from 'yox-type/src/options/Watcher'

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (options: type.watcher | WatcherOptions | void, immediate: boolean | void): WatcherOptions | void {

  if (is.func(options)) {
    return {
      watcher: options as type.watcher,
      immediate: immediate === env.TRUE,
    }
  }

  if (options && (options as WatcherOptions).watcher) {
    return options as WatcherOptions
  }

  if (process.env.NODE_ENV === 'dev') {
    logger.fatal(`watcher should be a function or object.`)
  }

}