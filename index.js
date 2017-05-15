
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import execute from 'yox-common/function/execute'
import Emitter from 'yox-common/util/Emitter'

export default class Observer {

  /**
   * @param {Object} options
   * @property {Object} options.data
   * @property {?Object} options.computed
   * @property {?*} options.context 执行 watcher 函数的 this 指向
   */
  constructor(options) {

    let {
      data,
      context,
      computed,
    } = options

    let instance = this

    instance.data = data
    instance.emitter = new Emitter()
    instance.context = context || instance

    // 缓存历史数据，便于对比变化
    instance.cache = { }
    // 谁依赖了谁
    instance.deps = { }
    // 谁被谁依赖
    instance.reversedDeps = { }

    // 计算属性也是数据
    if (is.object(computed)) {

      // 把计算属性拆为 getter 和 setter
      instance.computedGetters = { }
      instance.computedSetters = { }

      // 辅助获取计算属性的依赖
      instance.computedStack = [ ]

      let {
        cache,
        computedStack,
      } = instance

      object.each(
        computed,
        function (item, keypath) {

          let get, set, deps, cacheable = env.TRUE

          if (is.func(item)) {
            get = item
          }
          else if (is.object(item)) {
            if (item.deps) {
              deps = item.deps
            }
            if (is.boolean(item.cache)) {
              cacheable = item.cache
            }
            if (is.func(item.get)) {
              get = item.get
            }
            if (is.func(item.set)) {
              set = item.set
            }
          }

          if (get) {

            instance.computedGetters[ keypath ] = function () {

              if (cacheable) {
                if (object.has(cache, keypath)) {
                  return cache[ keypath ]
                }
                if (!deps) {
                  computedStack.push([ ])
                }
              }

              let value = execute(get, instance.context)
              cache[ keypath ] = value

              if (cacheable) {
                let newDeps = deps || array.pop(computedStack)
                if (is.array(newDeps)) {
                  instance.setDeps(keypath, newDeps)
                }
              }

              return value

            }

          }

          if (set) {
            instance.computedSetters[ keypath ] = set
          }

        }
      )
    }

  }

  /**
   * 获取数据
   *
   * @param {string} keypath
   * @param {*} defaultValue
   * @return {?*}
   */
  get(keypath, defaultValue) {

    let instance = this, result

    let {
      data,
      cache,
      computedStack,
      computedGetters,
    } = instance

    if (keypath === char.CHAR_BLANK) {
      return data
    }

    keypath = keypathUtil.normalize(keypath)

    if (computedStack) {
      let list = array.last(computedStack)
      if (list) {
        array.push(list, keypath)
      }
    }

    if (computedGetters) {
      let { value, rest } = matchBestGetter(computedGetters, keypath)
      if (value) {
        value = value()
        result = rest && !is.primitive(value)
          ? object.get(value, rest)
          : { value }
      }
    }

    if (!result) {
      result = object.get(data, keypath)
    }

    if (result) {
      return cache[ keypath ] = result.value
    }

    cache[ keypath ] = env.UNDEFINED
    return defaultValue

  }

  /**
   * 更新数据
   *
   * @param {Object} model
   */
  set(model) {

    let instance = this

    let {
      deps,
      data,
      cache,
      emitter,
      context,
      reversedDeps,
      computedGetters,
      computedSetters,
      watchKeypaths,
      reversedKeypaths,
    } = instance

    if (instance[ DIRTY ]) {

      delete instance[ DIRTY ]

      reversedDeps = { }
      watchKeypaths = { }

      object.each(
        emitter.listeners,
        function (list, key) {
          watchKeypaths[ key ] = env.TRUE
        }
      )

      object.each(
        deps,
        function (deps, key) {
          array.each(
            deps,
            function (dep) {
              watchKeypaths[ dep ] = env.TRUE
              array.push(
                reversedDeps[ dep ] || (reversedDeps[ dep ] = [ ]),
                key
              )
            }
          )
        }
      )

      reversedDeps = instance.reversedDeps = reversedDeps
      watchKeypaths = instance.watchKeypaths = object.sort(watchKeypaths, env.TRUE)
      reversedKeypaths = instance.reversedKeypaths = object.sort(reversedDeps, env.TRUE)

    }

    /**
     * a -> b -> c
     *
     * a 依赖 b，b 依赖 c
     *
     * 当修改 c 时，要通知 a 和 b 更新
     * 当修改 b 时，要通知 a 更新，不通知 c 更新
     * 当修改 a 时，仅自己更新
     *
     * 有时候，b 的数据来自 c 的过滤，当修改 b 时，实际是修改 c，这时候，应该从最深层开始往上通知
     *
     * 当监听 user.* 时，如果修改了 user.name，不仅要触发 user.name 的 watcher，也要触发 user.* 的 watcher
     *
     * 这里遵循的一个原则是，只有当修改数据确实产生了数据变化，才会分析它的依赖
     */

    let oldCache = { }, newCache = { }
    let getOldValue = function (keypath) {
      if (!object.has(oldCache, keypath)) {
        oldCache[ keypath ] =
        object.has(cache, keypath)
          ? cache[ keypath ]
          : instance.get(keypath)
      }
      return oldCache[ keypath ]
    }
    let getNewValue = function (keypath) {
      if (!object.has(newCache, keypath)) {
        newCache[ keypath ] = instance.get(keypath)
      }
      return newCache[ keypath ]
    }

    let joinKeypath = function (keypath1, keypath2) {
      return keypath1 + char.CHAR_DASH + keypath2
    }

    let differences = [ ], differenceMap = { }
    let addDifference = function (keypath, realpath, match) {
      let fullpath = joinKeypath(keypath, realpath)
      if (!differenceMap[ fullpath ]) {
        differenceMap[ fullpath ] = env.TRUE
        array.push(
          differences,
          {
            keypath,
            realpath,
            match,
            oldValue: getOldValue(realpath),
          }
        )
      }
    }

    object.each(
      model,
      function (newValue, keypath) {

        keypath = keypathUtil.normalize(keypath)

        if (computedSetters) {
          let setter = computedSetters[ keypath ]
          if (setter) {
            addDifference(keypath, keypath)
            execute(setter, context, newValue)
            return
          }
          else {
            let { value, rest } = matchBestGetter(computedGetters, keypath)
            if (value && rest) {
              value = value()
              if (!is.primitive(value)) {
                addDifference(keypath, keypath)
                object.set(value, rest, newValue)
              }
              return
            }
          }
        }

        addDifference(keypath, keypath)
        object.set(data, keypath, newValue)

      }
    )

    let i = -1, difference, keypath, realpath, oldValue, nextDifferences
    while (difference = differences[ ++i ]) {

      keypath = difference.keypath
      realpath = difference.realpath
      oldValue = difference.oldValue

      if (object.has(cache, realpath)) {
        delete cache[ realpath ]
      }

      if (getNewValue(realpath) !== oldValue
        || (difference.force = is.object(oldValue) || is.array(oldValue))
      ) {

        nextDifferences = instance.differences || (instance.differences = { })
        nextDifferences[ joinKeypath(keypath, realpath) ] = difference

        // 当 user.name 变化了
        // 要通知 user.* 的观察者们
        if (watchKeypaths) {
          array.each(
            watchKeypaths,
            function (key) {
              if (key !== realpath) {
                if (isFuzzyKeypath(key)) {
                  let match = matchKeypath(realpath, key)
                  if (match) {
                    addDifference(key, realpath, match)
                  }
                }
                else if (keypathUtil.startsWith(key, realpath) !== env.FALSE) {
                  addDifference(key, key)
                }
              }
            }
          )
        }

        // a 依赖 b
        // 当 b 变化了，要通知 a
        if (reversedKeypaths) {
          array.each(
            reversedKeypaths,
            function (key) {
              let list
              if (isFuzzyKeypath(key)) {
                let match = matchKeypath(realpath, key)
                if (match) {
                  list = reversedDeps[ key ]
                }
              }
              else if (key === realpath) {
                list = reversedDeps[ key ]
              }
              if (list) {
                array.each(
                  list,
                  function (key) {
                    addDifference(key, key)
                  }
                )
              }
            }
          )
        }

      }

    }

    if (nextDifferences && !instance.pending) {
      instance.pending = env.TRUE
      nextTask.append(
        function () {
          if (instance.pending) {
            // 冻结这批变化
            // 避免 fire 之后同步再次走进这里
            let { differences } = instance
            delete instance.pending
            delete instance.differences
            object.each(
              differences,
              function (difference) {
                let { keypath, oldValue } = difference, newValue = instance.get(difference.realpath)
                if (difference.force || oldValue !== newValue) {
                  let args = [ newValue, oldValue, keypath ]
                  if (difference.match) {
                    array.push(args, difference.match)
                  }
                  emitter.fire(keypath, args, context)
                }
              }
            )
          }
        }
      )
    }

  }

  setDeps(keypath, newDeps) {

    let instance = this
    let { deps } = instance

    if (newDeps !== deps[ keypath ]) {
      deps[ keypath ] = newDeps
      instance[ DIRTY ] = env.TRUE
    }

  }

  /**
   * 销毁
   */
  destroy() {
    this.emitter.off()
    object.clear(this)
  }

}

object.extend(
  Observer.prototype,
  {

    /**
     * 监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watch: createWatch('on'),

    /**
     * 监听一次数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watchOnce: createWatch('once'),

    /**
     * 取消监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     */
    unwatch: function (keypath, watcher) {
      if (this.emitter.off(keypath, watcher)) {
        this[ DIRTY ] = env.TRUE
      }
    }

  }
)

const DIRTY = '_dirty_'

/**
 * watch 和 watchOnce 逻辑相同
 * 提出一个工厂方法
 */
function createWatch(action) {

  return function (keypath, watcher, sync) {

    let watchers = keypath
    if (is.string(keypath)) {
      watchers = { }
      watchers[ keypath ] = { sync, watcher }
    }

    let instance = this

    object.each(
      watchers,
      function (value, keypath) {

        let watcher = value, sync
        if (is.object(value)) {
          watcher = value.watcher
          sync = value.sync
        }

        if (instance.emitter[ action ](keypath, watcher)) {
          instance[ DIRTY ] = env.TRUE
        }

        if (!isFuzzyKeypath(keypath)) {
          // 既然是 watch, 就先通过 get 缓存当前值，便于下次对比
          value = instance.get(keypath)
          // 立即执行，通过 Emitter 提供的 $magic 扩展实现
          if (sync) {

            let executed = env.FALSE,
            magic = function () {
              executed = env.TRUE
              if (watcher.$magic === magic) {
                delete watcher.$magic
              }
            }
            watcher.$magic = magic

            nextTask.append(
              function () {
                if (!executed && instance.context) {
                  execute(
                    watcher,
                    instance.context,
                    [ instance.get(keypath), value, keypath ]
                  )
                }
              }
            )

          }
        }

      }
    )

  }

}

let patternCache = { }

/**
 * 模糊匹配 Keypath
 *
 * @param {string} keypath
 * @param {string} pattern
 * @return {?Array.<string>}
 */
function matchKeypath(keypath, pattern) {
  let cache = patternCache[ pattern ]
  if (!cache) {
    cache = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    cache = patternCache[ pattern ] = new RegExp(`^${cache}$`)
  }
  let match = keypath.match(cache)
  if (match) {
    return array.toArray(match).slice(1)
  }
}

/**
 * 是否模糊匹配
 *
 * @param {string} keypath
 * @return {boolean}
 */
function isFuzzyKeypath(keypath) {
  return string.has(keypath, '*')
}

/**
 * 从 getter 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @param {Object} getters
 * @param {string} keypath
 * @return {Object}
 */
function matchBestGetter(getters, keypath) {

  let result = { }

  array.each(
    object.sort(getters, env.TRUE),
    function (prefix) {
      let length = keypathUtil.startsWith(keypath, prefix)
      if (length !== env.FALSE) {
        result.value = getters[ prefix ]
        result.rest = string.slice(keypath, length)
        return env.FALSE
      }
    }
  )

  return result

}
