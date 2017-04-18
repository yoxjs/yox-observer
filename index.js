
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as array from 'yox-common/util/array'
import * as object from 'yox-common/util/object'
import * as string from 'yox-common/util/string'
import * as nextTask from 'yox-common/util/nextTask'
import * as keypathUtil from 'yox-common/util/keypath'

import matchFirst from 'yox-common/function/matchFirst'
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
    instance.computedDeps = { }
    // 谁被谁依赖
    instance.computedDepsReversed = { }

    // 计算属性也是数据
    if (is.object(computed)) {

      // 把计算属性拆为 getter 和 setter
      instance.computedGetters = { }
      instance.computedSetters = { }

      // 辅助获取计算属性的依赖
      instance.computedStack = [ ]

      // 计算属性的缓存
      instance.computedCache = { }

      let {
        computedCache,
        computedStack,
        computedGetters,
        computedSetters
      } = instance

      object.each(
        computed,
        function (item, keypath) {

          let get, set, deps, cache = env.TRUE

          if (is.func(item)) {
            get = item
          }
          else if (is.object(item)) {
            if (is.boolean(item.cache)) {
              cache = item.cache
            }
            if (is.array(item.deps)) {
              deps = item.deps
            }
            if (is.func(item.get)) {
              get = item.get
            }
            if (is.func(item.set)) {
              set = item.set
            }
          }

          if (get) {

            instance.watch(
              keypath,
              function () {
                if (object.has(computedCache, keypath)) {
                  delete computedCache[ keypath ]
                }
              }
            )

            let getter = function () {
              if (cache && object.has(computedCache, keypath)) {
                return computedCache[ keypath ]
              }

              if (!deps) {
                computedStack.push([ ])
              }

              let result = execute(get, instance.context)
              if (cache) {
                computedCache[ keypath ] = result
              }

              instance.setComputedDeps(
                keypath,
                deps || array.pop(computedStack)
              )

              return result

            }

            getter.toString =
            computedGetters[ keypath ] = getter

          }

          if (set) {
            computedSetters[ keypath ] = set
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
   * 当传了 context，会尝试向上寻找
   *
   * @param {string} keypath
   * @param {string} context
   * @return {?*}
   */
  get(keypath, context) {

    let instance = this

    let {
      data,
      computedStack,
      computedGetters,
    } = instance

    let getValue = function (keypath) {

      if (computedStack) {
        let list = array.last(computedStack)
        if (list) {
          array.push(list, keypath)
        }
      }

      if (computedGetters) {

        let { value, rest } = matchKeypath(computedGetters, keypath)

        if (value) {
          value = value()
          return rest && !is.primitive(value)
            ? object.get(value, rest)
            : { value }
        }

      }

      return object.get(data, keypath)

    }

    let suffixes = keypathUtil.parse(keypath), temp, result

    if (is.string(context)) {
      let prefixes = keypathUtil.parse(context)
      if (suffixes.length > 1 && suffixes[ 0 ] === env.THIS) {
        keypath = keypathUtil.stringify(
          array.merge(
            prefixes,
            suffixes.slice(1)
          )
        )
        result = getValue(keypath)
      }
      else {
        keypath = env.NULL
        while (env.TRUE) {
          temp = keypathUtil.stringify(
            array.merge(
              prefixes,
              suffixes
            )
          )
          result = getValue(temp)
          if (result) {
            keypath = temp
            break
          }
          else {
            if (keypath == env.NULL) {
              keypath = temp
            }
            if (!prefixes.length) {
              break
            }
            else {
              array.pop(prefixes)
            }
          }
        }
      }
      if (!result) {
        result = { }
      }
      result.keypath = keypath
      return result
    }
    else {
      result = getValue(
        keypathUtil.stringify(suffixes)
      )
      if (result) {
        return result.value
      }
    }

  }

  /**
   * 更新数据
   *
   * @param {Object} model
   */
  set(model) {

    let instance = this, differences = { }

    let {
      data,
      cache,
      emitter,
      context,
      computedDeps,
      computedDepsReversed,
      computedGetters,
      computedSetters,
      watchKeypaths,
    } = instance

    let addDifference = function (key, data, extra) {
      if (!differences[ key ]) {
        if (extra) {
          array.push(data, extra)
        }
        differences[ key ] = data
      }
    }

    object.each(
      model,
      function (newValue, keypath) {

        // 格式化成内部处理的格式
        keypath = keypathUtil.normalize(keypath)

        array.each(
          watchKeypaths,
          function (key) {
            if (string.has(key, '*')) {
              let pattern = getKeypathPattern(key)
              let match = keypath.match(pattern)
              if (match) {
                addDifference(
                  keypath,
                  [ instance.get(keypath), keypath ],
                  array.toArray(match).slice(1)
                )
              }
            }
            else if (string.startsWith(key, keypath)) {
              addDifference(
                key,
                [ instance.get(key), key ]
              )
            }
          }
        )

        // 如果有计算属性，则优先处理它
        if (computedSetters) {
          let setter = computedSetters[ keypath ]
          if (setter) {
            setter.call(context, newValue)
            return
          }
          else {
            let { value, rest } = matchKeypath(computedGetters, keypath)
            if (value && rest) {
              value = value()
              if (!is.primitive(value)) {
                object.set(value, rest, newValue)
              }
              return
            }
          }
        }

        // 普通数据
        object.set(data, keypath, newValue)

      }
    )

    object.each(
      differences,
      function (difference, keypath) {
        let newValue = instance.get(keypath)
        if (newValue !== difference[ 0 ]) {
          difference.unshift(newValue)
          emitter.fire(
            keypath,
            difference,
            context
          )

          let list = computedDepsReversed[ keypath ]
          if (list) {
            array.each(
              list,
              function (keypath) {
                newValue = instance.get(keypath)
                emitter.fire(
                  keypath,
                  [ newValue, newValue, keypath ],
                  context
                )
              }
            )
          }

        }
      }
    )

  }

  setComputedDeps(keypath, deps) {

    let {
      computedDeps,
      computedDepsReversed,
    } = this

    if (deps !== computedDeps[ keypath ]) {

      computedDeps[ keypath ] = deps
      updateWatchKeypaths(this)

      // 全量更新
      computedDepsReversed = this.computedDepsReversed = { }

      let addDep = function (dep, keypath) {
        let list = computedDepsReversed[ dep ] || (computedDepsReversed[ dep ] = [ ])
        array.push(list, keypath)
      }

      object.each(
        computedDeps,
        function (deps, key) {
          array.each(
            deps,
            function (dep) {
              addDep(dep, key)
            }
          )
        }
      )

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
      this.emitter.off(keypath, watcher)
      updateWatchKeypaths(this)
    }

  }
)

function updateWatchKeypaths(instance) {

  let {
    emitter,
    computedDeps,
  } = instance

  let watchKeypaths = { }

  let addKeypath = function (keypath) {
    if (!watchKeypaths[ keypath ]) {
      watchKeypaths[ keypath ] = env.TRUE
    }
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
    computedDeps,
    function (deps) {
      array.each(
        deps,
        addKeypath
      )
    }
  )

  instance.watchKeypaths = object.keys(watchKeypaths)

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

        if (sync) {
          execute(
            watcher,
            context,
            [ instance.get(keypath), env.UNDEFINED, keypath ]
          )
        }

      }
    )

  }

}


let patternCache = { }

/**
 * 模糊匹配 Keypath
 */
function getKeypathPattern(keypath) {
  if (!patternCache[ keypath ]) {
    let literal = keypath
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '([\.\\w]+?)')
      .replace(/\*/g, '(\\w+)')
    patternCache[ keypath ] = new RegExp(`^${literal}$`)
  }
  return patternCache[ keypath ]
}

/**
 * 从 data 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @param {Object} data
 * @param {Object} keypath
 * @return {Object}
 */
function matchKeypath(data, keypath) {

  let result = matchFirst(
    object.sort(data, env.TRUE),
    keypath
  )

  let matched = result[ 0 ], rest = result[ 1 ], value
  if (matched) {
    value = data[ matched ]
  }

  if (rest && string.startsWith(rest, keypathUtil.SEPARATOR_KEY)) {
    rest = string.slice(rest, 1)
  }

  return {
    value,
    rest,
  }

}
