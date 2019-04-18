import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'

import WatcherOptions from 'yox-type/src/WatcherOptions'

const immediateWatcherOptions: WatcherOptions = { immediate: env.TRUE },

defaultWatcherOptions: WatcherOptions = env.EMPTY_OBJECT

/**
 * 格式化 watch options
 *
 * @param options
 */
export default function (options: boolean | WatcherOptions | void): WatcherOptions {
  return options === env.TRUE
    ? immediateWatcherOptions
    : is.object(options)
      ? options as WatcherOptions
      : defaultWatcherOptions
}