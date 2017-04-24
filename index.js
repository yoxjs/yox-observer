
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
   * @property {?Object} options.watchers
   * @property {?*} options.context 执行 watcher 函数的 this 指向
   */
  constructor(options) {

    let {
      data,
      context,
      computed,
      watchers,
    } = options

    let instance = this

    instance.data = data
    instance.cache = { }
    instance.emitter = new Emitter()
    instance.context = context || instance

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

            if (cacheable) {
              instance.watch(
                keypath + FORCE,
                function () {
                  getter[ DIRTY ] = env.TRUE
                }
              )
            }

            let getter = function () {

              if (cacheable) {
                if (getter[ DIRTY ]) {
                  delete getter[ DIRTY ]
                }
                else if (object.has(cache, keypath)) {
                  return cache[ keypath ]
                }
              }

              if (!deps) {
                computedStack.push([ ])
              }

              let result = execute(get, instance.context)
              cache[ keypath ] = result

              let newDeps = deps || array.pop(computedStack)
              if (is.array(newDeps)) {
                instance.setDeps(keypath, newDeps)
              }

              return result

            }

            getter.toString =
            instance.computedGetters[ keypath ] = getter

          }

          if (set) {
            instance.computedSetters[ keypath ] = set
          }

        }
      )
    }

    if (is.object(watchers)) {
      instance.watch(watchers)
    }

  }

  /**
   * 获取数据
   *
   * @param {string} keypath
   * @return {?*}
   */
  get(keypath) {

    let instance = this

    let {
      data,
      cache,
      computedStack,
      computedGetters,
    } = instance

    if (!keypath) {
      return data
    }

    keypath = keypathUtil.normalize(keypath)

    if (computedStack) {
      let list = array.last(computedStack)
      if (list) {
        array.push(list, keypath)
      }
    }

    let result
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

  }

  /**
   * 更新数据
   *
   * @param {Object} model
   */
  set(model) {

    let instance = this

    let {
      data,
      cache,
      emitter,
      context,
      deps,
      reversedDeps,
      computedGetters,
      computedSetters,
      watchKeypaths,
      reversedKeypaths,
    } = instance


    /**
     * a -> b -> c
     *
     * a 依赖 b，b 依赖 c
     *
     * 当修改 c 时，要通知 a 和 b 更新
     * 当修改 b 时，要通知 a 更新，不通知 c 更新
     * 当修改 a 时，仅自己更新
     *
     * 当监听 user.* 时，如果修改了 user.name，不仅要触发 user.name 的 watcher，也要触发 user.* 的 watcher
     *
     * 这里遵循的一个原则是，只有当修改数据确实产生了数据变化，才会分析它的依赖
     */

    let differences = [ ], differenceMap = { }
    let addDifference = function (keypath, realpath, oldValue, match, force) {
      let fullpath = keypath + char.CHAR_DASH + realpath
      if (!differenceMap[ fullpath ]) {
        differenceMap[ fullpath ] = env.TRUE
        array.push(
          differences,
          {
            keypath,
            realpath,
            oldValue,
            match,
            force,
          }
        )
      }
    }

    let oldCache = { }, newCache = { }
    let getOldValue = function (keypath) {
      if (!object.has(oldCache, keypath)) {
        oldCache[ keypath ] = cache[ keypath ]
      }
      return oldCache[ keypath ]
    }
    let getNewValue = function (keypath) {
      if (!object.has(newCache, keypath)) {
        newCache[ keypath ] = instance.get(keypath)
      }
      return newCache[ keypath ]
    }

    let reversedDepMap = { }
    let addReversedDepKeypath = function (keypath) {
      if (reversedKeypaths && !reversedDepMap[ keypath ]) {
        reversedDepMap[ keypath ] = env.TRUE
        array.each(
          reversedKeypaths,
          function (key) {
            let list, match
            if (key === keypath) {
              list = reversedDeps[ key ]
            }
            else if (isFuzzyKeypath(key)) {
              match = matchKeypath(keypath, key)
              if (match) {
                list = reversedDeps[ key ]
              }
            }
            if (list) {
              array.each(
                list,
                function (key) {
                  addDifference(key, key, getOldValue(key), env.UNDEFINED, env.TRUE)
                }
              )
            }
          }
        )
      }
    }

    object.each(
      model,
      function (newValue, keypath) {

        keypath = keypathUtil.normalize(keypath)

        addDifference(keypath, keypath, getOldValue(keypath))

        if (computedSetters) {
          let setter = computedSetters[ keypath ]
          if (setter) {
            setter.call(context, newValue)
            return
          }
          else {
            let { value, rest } = matchBestGetter(computedGetters, keypath)
            if (value && rest) {
              value = value()
              if (!is.primitive(value)) {
                object.set(value, rest, newValue)
              }
              return
            }
          }
        }

        object.set(data, keypath, newValue)

      }
    )

    let fireDifference = function ({ keypath, realpath, oldValue, match, force }) {

      let newValue = force ? oldValue : getNewValue(realpath)
      if (force || newValue !== oldValue) {

        let args = [ newValue, oldValue, keypath ]
        if (match) {
          array.push(args, match)
        }
        emitter.fire(keypath + (force ? FORCE : char.CHAR_BLANK), args, context)

        newValue = getNewValue(realpath)
        if (newValue !== oldValue) {
          if (force) {
            args[ 0 ] = newValue
            emitter.fire(keypath, args, context)
          }
          array.each(
            watchKeypaths,
            function (key) {
              if (key !== realpath) {
                if (isFuzzyKeypath(key)) {
                  let match = matchKeypath(realpath, key)
                  if (match) {
                    addDifference(key, realpath, getOldValue(realpath), match)
                  }
                }
                else if (keypathUtil.startsWith(key, realpath)) {
                  addDifference(key, key, getOldValue(key))
                }
              }
            }
          )
          addReversedDepKeypath(realpath)
        }
      }
    }

    for (let i = 0; i < differences.length; i++) {
      fireDifference(differences[ i ])
    }

  }

  setDeps(keypath, newDeps) {

    let instance = this

    let {
      deps,
      reversedDeps,
    } = instance

    if (newDeps !== deps[ keypath ]) {

      deps[ keypath ] = newDeps
      updateWatchKeypaths(instance)

      // 全量更新
      reversedDeps = { }

      object.each(
        deps,
        function (deps, key) {
          array.each(
            deps,
            function (dep) {
              array.push(
                reversedDeps[ dep ] || (reversedDeps[ dep ] = [ ]),
                key
              )
            }
          )
        }
      )

      instance.reversedDeps = reversedDeps
      instance.reversedKeypaths = object.sort(reversedDeps, env.TRUE)

    }

  }

  setCache(keypath, value) {
    this.cache[ keypath ] = value
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
      this.emitter.off(keypath, watcher)
      updateWatchKeypaths(this)
    }

  }
)

const FORCE = '._force_'
const DIRTY = '_dirty_'

function updateWatchKeypaths(instance) {

  let {
    deps,
    emitter,
  } = instance

  let watchKeypaths = { }

  let addKeypath = function (keypath) {
    watchKeypaths[ keypath ] = env.TRUE
  }

  // 1. 直接通过 watch 注册的
  object.each(
    emitter.listeners,
    function (list, key) {
      addKeypath(key)
    }
  )

  // 2. 计算属性的依赖属于间接 watch
  object.each(
    deps,
    function (deps) {
      array.each(
        deps,
        addKeypath
      )
    }
  )

  instance.watchKeypaths = object.sort(watchKeypaths, env.TRUE)

}

/**
 * watch 和 watchOnce 逻辑相同
 * 提出一个工厂方法
 */
function createWatch(action) {

  return function (keypath, watcher, sync) {

    let watchers = keypath
    if (is.string(keypath)) {
      watchers = { }
      watchers[ keypath ] = {
        sync,
        watcher,
      }
    }

    let instance = this

    let {
      emitter,
      context,
    } = instance

    object.each(
      watchers,
      function (value, keypath) {

        let watcher = value, sync
        if (is.object(value)) {
          watcher = value.watcher
          sync = value.sync
        }

        emitter[ action ](keypath, watcher)
        updateWatchKeypaths(instance)

        if (!isFuzzyKeypath(keypath)) {
          nextTask.append(
            function () {
              // get 会缓存一下当前值，便于下次对比
              value = instance.get(keypath)
              if (sync) {
                execute(
                  watcher,
                  context,
                  [ value, env.UNDEFINED, keypath ]
                )
              }
            }
          )
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

  let key, value, rest

  array.each(
    object.sort(getters, env.TRUE),
    function (prefix) {
      if (prefix = keypathUtil.startsWith(keypath, prefix, env.TRUE)) {
        key = prefix[ 0 ]
        value = getters[ key ]
        rest = prefix[ 1 ]
        return env.FALSE
      }
    }
  )

  return { key, value, rest }

}
