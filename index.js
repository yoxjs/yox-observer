
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
    instance.emitter = new Emitter()
    instance.families = { }
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

      let {
        computedCache,
        computedStack,
        computedDeps,
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

            let watcher = function () {
              if (object.has(computedCache, keypath)) {
                delete computedCache[ keypath ]
              }
            }

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

              let newDeps = deps || array.pop(computedStack)
              let oldDeps = computedDeps[ keypath ]
              computedDeps[ keypath ] = instance.diff(newDeps, oldDeps, watcher)

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

        let { matched, rest } = matchKeypath(computedGetters, keypath)

        if (matched) {
          matched = matched()
          return rest && !is.primitive(matched)
            ? object.get(matched, rest)
            : { value: matched }
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

    let instance = this, differences = [ ]

    let {
      data,
      families,
      emitter,
      context,
      computedGetters,
      computedSetters,
    } = instance

    let allKeys = object.keys(families)

    object.each(
      model,
      function (newValue, keypath, oldValue) {

        // 格式化成内部处理的格式
        keypath = keypathUtil.normalize(keypath)

        array.each(
          allKeys,
          function (key) {
            if (string.startsWith(key, keypath)) {
              differences[ key ] = [ instance.get(key), key ]
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
            let { matched, rest } = matchKeypath(computedGetters, keypath)
            if (matched && rest) {
              matched = matched()
              if (!is.primitive(matched)) {
                object.set(matched, rest, newValue)
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
        }
      }
    )

  }

  /**
   * 为一批 keypath 注册一个 watcher
   */
  diff(newKeypaths, oldKeypaths, watcher) {

    if (newKeypaths !== oldKeypaths) {

      let instance = this

      oldKeypaths = oldKeypaths || [ ]
      array.each(
        newKeypaths,
        function (keypath) {
          if (!array.has(oldKeypaths, keypath)) {
            instance.watch(keypath, watcher)
          }
        }
      )
      array.each(
        oldKeypaths,
        function (keypath) {
          if (!array.has(newKeypaths, keypath)) {
            instance.unwatch(keypath, watcher)
          }
        }
      )

    }

    return newKeypaths

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
    watch: createWatch(
      function (instance, family, emitter) {
        family.execute(emitter, 'on')
      }
    ),

    /**
     * 监听一次数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     * @param {?boolean} sync
     */
    watchOnce: createWatch(
      function (instance, family, emitter) {
        family.watcher.$magic = function () {
          instance.unwatch(family.keypath, family.watcher)
        }
        family.execute(emitter, 'on')
      }
    ),

    /**
     * 取消监听数据变化
     *
     * @param {string|Object} keypath
     * @param {?Function} watcher
     */
    unwatch: function (keypath, watcher) {
      let { emitter, families } = this
      object.each(
        families,
        function (list, key) {
          if (key === keypath) {
            array.each(
              list,
              function (family, index) {
                if (family.watcher === watcher) {
                  family.execute(emitter, 'off')
                  list.splice(index, 1)
                }
              },
              env.TRUE
            )
          }
        }
      )
    }

  }
)

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
      families,
      context,
      computedDeps,
    } = instance

    let collect = function (keypath, filter, deps) {

      if (!deps) {
        deps = [ ]
      }

      // 排序，把依赖最少的放前面
      let addDep = function (keypath, push) {
        if (keypath !== filter && !array.has(deps, keypath)) {
          if (push) {
            array.push(deps, keypath)
          }
          else {
            array.unshift(deps, keypath)
          }
        }
      }

      if (computedDeps && !array.falsy(computedDeps[ keypath ])) {
        array.each(
          computedDeps[ keypath ],
          function (keypath) {
            if (keypath) {
              collect(keypath, filter, deps)
            }
          }
        )
        addDep(keypath, env.TRUE)
      }
      else {
        addDep(keypath)
      }

      return deps

    }

    object.each(
      watchers,
      function (value, keypath) {

        let watcher = value, sync
        if (is.object(value)) {
          watcher = value.watcher
          sync = value.sync
        }

        let list = families[ keypath ] || (families[ keypath ] = [ ])
        let item = new Family(keypath, collect(keypath, keypath), watcher)
        array.push(list, item)

        action(instance, item, emitter)

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

/**
 * keypath deps watcher 三者的综合体
 * 绑定在一起方便进行增删
 */
class Family {

  constructor(keypath, value, watcher) {
    this.keypath = keypath
    this.deps = [ ]
    this.watcher = watcher
  }

  execute(emitter, action) {
    let instance = this
    emitter[ action ](instance.keypath, instance.watcher)
    array.each(
      instance.deps,
      function (keypath) {
        emitter[ action ](keypath, instance.watcher)
      }
    )
  }

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

  let matched = result[ 0 ], rest = result[ 1 ]

  return {
    matched,
    rest: rest && string.startsWith(rest, keypathUtil.SEPARATOR_KEY)
      ? string.slice(rest, 1)
      : rest
  }

}
