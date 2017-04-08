
import * as is from 'yox-common/util/is'
import * as env from 'yox-common/util/env'
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

    // 计算属性也是数据
    if (is.object(computed)) {

      // 把计算属性拆为 getter 和 setter
      instance.computedGetters = { }
      instance.computedSetters = { }

      // 辅助获取计算属性的依赖
      instance.computedStack = [ ]
      instance.computedDeps = { }

      // 计算属性的缓存
      instance.computedCache = { }

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

            let watcher = function () {
              getter.dirty = env.TRUE
            }

            let getter = function () {
              let { computedCache } = instance
              if (!getter.dirty) {
                if (cache && object.has(computedCache, keypath)) {
                  return computedCache[ keypath ]
                }
              }
              else {
                delete getter.dirty
              }

              if (!deps) {
                instance.computedStack.push([ ])
              }

              let result = execute(get, instance.context)
              if (cache) {
                computedCache[ keypath ] = result
              }

              let newDeps = deps || instance.computedStack.pop()
              let oldDeps = instance.computedDeps[ keypath ]
              instance.computedDeps[ keypath ] = instance.diff(newDeps, oldDeps, watcher)

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

    let result, temp
    let suffixes = keypathUtil.parse(keypath)

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
              prefixes.pop()
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
      buffer,
      emitter,
      context,
      computedGetters,
      computedSetters,
    } = instance

    object.each(
      model,
      function (newValue, keypath) {

        // 格式化成内部处理的格式
        keypath = keypathUtil.normalize(keypath)

        // 如果监听了这个 keypath
        // 就要确保有一份可对比的数据
        if (emitter.has(keypath) && !object.has(cache, keypath)) {
          cache[ keypath ] = instance.get(keypath)
        }

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

    instance.dispatch()

  }

  /**
   * 取消监听数据变化
   *
   * @param {string|Object} keypath
   * @param {?Function} watcher
   */
  unwatch(keypath, watcher) {
    this.emitter.off(keypath, watcher)
  }

  diff(newKeypaths, oldKeypaths, watcher) {

    if (newKeypaths !== oldKeypaths) {

      let instance = this
      let { computedDeps } = instance

      let collection = [ ]
      array.each(
        newKeypaths,
        function (keypath) {
          collectDeps(collection, keypath, computedDeps)
        }
      )

      oldKeypaths = oldKeypaths || [ ]
      array.each(
        collection,
        function (keypath) {
          if (!array.has(oldKeypaths, keypath)) {
            instance.watch(keypath, watcher)
          }
        }
      )
      array.each(
        oldKeypaths,
        function (keypath) {
          if (!array.has(collection, keypath)) {
            instance.unwatch(keypath, watcher)
          }
        }
      )

      newKeypaths = collection

    }

    return newKeypaths

  }

  /**
   * 清空当前存在的不同新旧值
   */
  dispatch() {

    let instance = this

    let {
      cache,
      emitter,
      context,
      computedDeps,
    } = instance

    let collection = [ ]

    object.each(
      cache,
      function (value, keypath) {
        collectDeps(collection, keypath, computedDeps)
      }
    )

    array.each(
      collection,
      function (keypath) {
        let newValue = instance.get(keypath)
        let oldValue = cache[ keypath ]
        if (newValue !== oldValue) {
          cache[ keypath ] = newValue
          emitter.fire(keypath, [ newValue, oldValue, keypath ], context)
        }
      }
    )

  }

  /**
   * 销毁
   */
  destroy() {

    let instance = this

    instance.emitter.off()

    object.each(
      instance,
      function (value, key) {
        delete instance[ key ]
      }
    )

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
    watchOnce: createWatch('once')

  }
)

/**
 * watch 和 watchOnce 逻辑相同
 * 提出一个工厂方法
 */
function createWatch(method) {

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
      cache,
      emitter,
      context,
    } = instance

    object.each(
      watchers,
      function (value, keypath) {
        let currentValue = instance.get(keypath)
        if (is.func(value)) {
          emitter[ method ](keypath, value)
        }
        else if (is.object(value)) {
          emitter[ method ](keypath, value.watcher)
          if (value.sync) {
            execute(
              value.watcher,
              context,
              [ currentValue, cache[ keypath ], keypath ]
            )
          }
        }
        if (!object.has(cache, keypath)) {
          cache[ keypath ] = currentValue
        }
      }
    )

  }

}

/**
 * 从 data 对象的所有 key 中，选择和 keypath 最匹配的那一个
 *
 * @inner
 * @param {Object} data
 * @param {Object} keypath
 * @return {Object}
 */
function matchKeypath(data, keypath) {

  let value, rest

  array.each(
    object.sort(data, env.TRUE),
    function (prefix, index) {
      if (string.startsWith(keypath, prefix)) {
        value = data[ prefix ]
        rest = string.slice(keypath, prefix.length)
        return env.FALSE
      }
    }
  )

  return {
    value,
    rest: rest && string.startsWith(rest, keypathUtil.SEPARATOR_KEY)
      ? string.slice(rest, 1)
      : rest
  }

}

/**
 * 收集依赖
 *
 * @inner
 * @param {Array} collection
 * @param {string} keypath
 * @param {Object} deps 依赖关系
 * @return {Object}
 */
function collectDeps(collection, keypath, deps) {

  // 排序，把依赖最少的放前面
  let addKey = function (keypath, push) {
    if (!array.has(collection, keypath)) {
      if (push) {
        array.push(collection, keypath)
      }
      else {
        array.unshift(collection, keypath)
      }
    }
  }

  if (deps && !array.falsy(deps[ keypath ])) {
    array.each(
      deps[ keypath ],
      function (keypath) {
        if (keypath) {
          collectDeps(collection, keypath, deps)
        }
      }
    )
    addKey(keypath, env.TRUE)
  }
  else {
    addKey(keypath)
  }

}
