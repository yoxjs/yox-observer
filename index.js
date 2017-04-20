
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
import * as char from 'yox-common/util/char'
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
            if (is.boolean(item.cache)) {
              cacheable = item.cache
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
                if (object.has(cache, keypath)) {
                  delete cache[ keypath ]
                }
              }
            )

            let getter = function () {
              if (cacheable && object.has(cache, keypath)) {
                return cache[ keypath ]
              }

              if (!deps) {
                computedStack.push([ ])
              }

              let result = execute(get, instance.context)
              cache[ keypath ] = result

              instance.setDeps(
                keypath,
                deps || array.pop(computedStack)
              )

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
   * 当传了 context，会尝试向上寻找
   *
   * @param {string} keypath
   * @param {?string} context
   * @return {?*}
   */
  get(keypath, context) {

    let instance = this

    let {
      data,
      cache,
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

      let result
      if (computedGetters) {
        let { getter, rest } = matchBestGetter(computedGetters, keypath)
        if (getter) {
          getter = getter()
          result = rest && !is.primitive(getter)
            ? object.get(getter, rest)
            : { value: getter }
        }
      }

      if (!result) {
        result = object.get(data, keypath)
      }

      if (result) {
        cache[ keypath ] = result.value
      }

      return result

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

    let watchedMap = { }
    let addWatchKeypath = function (keypath) {
      // 最后触发主动监听的 keypath，相当于捡漏
      // 比如修改了 user 但是 watch 了 user.name
      // 这时需要确保 user.name 也能触发变化
      if (watchKeypaths && !watchedMap[ keypath ]) {
        watchedMap[ keypath ] = env.TRUE
        array.each(
          watchKeypaths,
          function (key) {
            if (isFuzzyKeypath(key)) {
              let match = matchKeypath(keypath, key)
              if (match) {
                addDifference(key, keypath, getOldValue(keypath), match)
              }
            }
            else if (string.startsWith(key, keypath)) {
              addDifference(key, key, getOldValue(key))
            }
            // 为子组件传递数据，比如 user="{{user}}"
            // 修改了 user.name 并不会引起子组件更新
            else if (string.startsWith(keypath, key)) {
              addDifference(key, key, getOldValue(key), env.UNDEFINED, env.TRUE)
            }
          }
        )
      }
    }

    let reversedMap = { }
    let addReversedKeypath = function (keypath) {
      if (reversedKeypaths && !reversedMap[ keypath ]) {
        reversedMap[ keypath ] = env.TRUE
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

        addWatchKeypath(keypath)

        // 如果有计算属性，则优先处理它
        if (computedSetters) {
          let setter = computedSetters[ keypath ]
          if (setter) {
            setter.call(context, newValue)
            return
          }
          else {
            let { getter, rest } = matchBestGetter(computedGetters, keypath)
            if (getter && rest) {
              getter = getter()
              if (!is.primitive(getter)) {
                object.set(getter, rest, newValue)
              }
              return
            }
          }
        }

        // 普通数据
        object.set(data, keypath, newValue)

      }
    )


    let fireChange = function ({ keypath, realpath, oldValue, match, force }) {
      let newValue = getNewValue(realpath)
      if (force || oldValue !== newValue) {
        let args = [ newValue, oldValue, keypath ]
        if (match) {
          array.push(args, match)
        }
        emitter.fire(keypath, args, context)
        addReversedKeypath(keypath)
        addWatchKeypath(realpath)
      }
    }

    for (let i = 0; i < differences.length; i++) {
      fireChange(differences[ i ])
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
      instance.reversedKeypaths = object.keys(reversedDeps)

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
      cache,
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

  let result = matchFirst(
    object.sort(getters, env.TRUE),
    keypath
  )

  let matched = result[ 0 ], rest = result[ 1 ]

  return {
    getter: matched ? getters[ matched ] : env.NULL,
    rest: rest && string.startsWith(rest, keypathUtil.SEPARATOR_KEY)
      ? string.slice(rest, 1)
      : rest
  }

}
